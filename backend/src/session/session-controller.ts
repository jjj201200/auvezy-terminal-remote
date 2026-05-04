/**
 * SessionController
 *
 * 系统的核心协调器：把 PTY、WsServer、OutputBuffer、HookReceiver 这些独立模块
 * 编织成一个完整的会话流。它本身不直接调用 node-pty 或 ws 库，而是通过依赖注入
 * 接收已构造好的实例，便于测试与扩展。
 *
 * 责任：
 *  1. 监听 PTY data 事件 → 三向分发：PC stdout、OutputBuffer 历史、WS 批合并广播
 *  2. 监听 WS 客户端消息 → 透传到 PTY（user_input → write，resize → resize）
 *  3. 维护 SessionStatus 状态机（idle / running / waiting_input）
 *  4. 客户端连入时立即推送 history_sync（含全量缓冲、当前 status、当前 PTY 尺寸）
 *  5. PTY exit 时广播 session_ended 并 flush 剩余缓冲
 *
 * 不负责：
 *  - 鉴权（WsServer 在 upgrade 阶段处理）
 *  - 客户端类型判定（WsServer 注入到回调里）
 *  - 主从仲裁的复杂规则（阶段 7 启用 attach 时再加）
 *
 * WS 输出批合并（性能关键）：
 *  - PTY 高频小输出会让 xterm.js 在手机端卡顿
 *  - 累积写入 → 16ms 时间窗 / 32KB 阈值 / 256KB 高水位强制 flush
 *  - 配合手机端的 useTerminal 批写入实现两端协同
 */

import type { WebSocket } from 'ws';
import type { SessionStatus } from '@ocr/shared';
import type { IPtyManager } from '../pty/types.js';
import { PtyManager } from '../pty/pty-manager.js';
import { OutputBuffer } from '../pty/output-buffer.js';
import { WsServer, type ClientType, type ClientCounts } from '../ws/ws-server.js';
import { handleWsMessage } from '../ws/ws-handler.js';
import { HookReceiver, type HookNotification } from '../hooks/hook-receiver.js';
import { AnsiFilter } from '../utils/ansi-filter.js';
import { logger } from '../logger/logger.js';
import {
  WS_FLUSH_INTERVAL_MS,
  WS_MAX_CHUNK_BYTES,
  WS_HIGH_WATERMARK_BYTES,
} from '../constants.js';

/**
 * 控制器外部可注入的可选服务
 */
export interface SessionControllerOptions {
  /** 是否把 PTY 输出同时写到本进程 stdout（PC 终端可见）。默认 true。 */
  writeToProcessStdout?: boolean;
  /**
   * 是否启用 alt-screen ANSI 过滤。默认 true（与上游不同）：
   *   - 进入 alt screen 后的内容不进 OutputBuffer / 不广播
   *   - 重连时 history_sync 不会被 alt screen 临时画面污染
   * 想保留 alt 内容的用户可关闭此开关。
   */
  ansiFilter?: boolean;
}

export class SessionController {
  // ──────────── 状态 ────────────
  private _status: SessionStatus = 'idle';
  private readonly buffer: OutputBuffer;
  private readonly writeToProcessStdout: boolean;

  // ──────────── WS 输出批合并 ────────────
  /** 待 flush 的输出片段队列 */
  private wsPendingChunks: string[] = [];
  /** 待 flush 的总字节数 */
  private wsPendingBytes = 0;
  /** 16ms 时间窗 timer */
  private wsFlushTimer: NodeJS.Timeout | null = null;

  // ──────────── 调试统计（PTY 退出时打印） ────────────
  private ptyTotalBytes = 0;
  private wsFlushCount = 0;
  private wsFlushBytesTotal = 0;
  private wsMaxPendingBytes = 0;
  private wsBackpressureEvents = 0;

  /** 可选的 hook 接收器（阶段 3 启用） */
  private hookReceiver: HookReceiver | null = null;

  /** ANSI 过滤器（阶段 8 启用；null = 关闭过滤直接透传） */
  private readonly ansiFilter: AnsiFilter | null;

  constructor(
    private readonly pty: PtyManager,
    private readonly ws: WsServer,
    maxBufferLines: number,
    opts: SessionControllerOptions = {},
  ) {
    this.buffer = new OutputBuffer(maxBufferLines);
    this.writeToProcessStdout = opts.writeToProcessStdout ?? true;
    this.ansiFilter = (opts.ansiFilter ?? true) ? new AnsiFilter() : null;
    this.wirePty();
    this.wireWs();
  }

  /**
   * 注入 HookReceiver
   *
   * 设计为 setter 而非构造参数，因为 HookReceiver 只在阶段 3+ 启用，
   * 且阶段 6a Web 创建实例的 headless 模式可能不需要它。
   */
  setHookReceiver(receiver: HookReceiver): void {
    if (this.hookReceiver) {
      logger.warn('SessionController.setHookReceiver 重复调用，覆盖旧 receiver');
    }
    this.hookReceiver = receiver;
    receiver.on('notification', (notif: HookNotification) => this.onHookNotification(notif));
  }

  /**
   * 处理 hook 触发的审批通知
   *
   * - 状态切到 waiting_input
   * - 广播 status_update 让前端 StatusBar 显示警告色
   * - detail 字段附加工具名让用户知道是哪个工具在等
   *
   * 不直接广播文本提示——审批 prompt 已经通过 PTY 输出到 xterm 显示了，
   * 用户在 xterm 内输入 y/Esc 即可
   */
  private onHookNotification(notif: HookNotification): void {
    logger.info({ tool: notif.tool }, '审批通知到达，切到 waiting_input');
    this._status = 'waiting_input';
    this.ws.broadcast({
      type: 'status_update',
      status: 'waiting_input',
      detail: `等待审批：${notif.tool}`,
    });
  }

  // ──────────────── 公共 API ────────────────

  get status(): SessionStatus {
    return this._status;
  }

  get connectedClients(): number {
    return this.ws.clientCount;
  }

  /**
   * 主动设置状态并广播给所有客户端
   *
   * 例如服务启动后将 idle → running，PTY 退出时 running → idle
   */
  setStatus(status: SessionStatus, detail?: string): void {
    this._status = status;
    this.ws.broadcast({ type: 'status_update', status, ...(detail ? { detail } : {}) });
  }

  /**
   * 析构：清理批合并 timer，最后一次 flush
   *
   * 在 SIGTERM / SIGINT 优雅关闭时调用
   */
  destroy(): void {
    this.flushPendingWsOutput();
  }

  // ──────────────── PTY → 三向分发 ────────────────

  private wirePty(): void {
    this.pty.on('data', (data: string) => {
      this.ptyTotalBytes += Buffer.byteLength(data, 'utf8');

      // 1. PC 终端：始终用原始数据（PC 终端可正常显示 alt screen 应用，
      //    用户在 PC 上看 vim 等是有意义的）
      if (this.writeToProcessStdout) {
        process.stdout.write(data);
      }

      // 2/3 路使用过滤后的数据（如启用过滤）：避免 alt screen 内容
      //     污染 OutputBuffer（重连回放）和广播给 webapp
      const filtered = this.ansiFilter ? this.ansiFilter.filter(data) : data;
      if (filtered.length === 0) return;

      this.buffer.append(filtered);
      this.enqueueWsOutput(filtered);
    });

    this.pty.on('exit', (exitCode: number) => {
      // 先 flush 剩余输出，让最后一行能到达客户端
      this.flushPendingWsOutput();
      this._status = 'idle';
      this.ws.broadcast({
        type: 'session_ended',
        exitCode,
        reason:
          exitCode === 0 ? 'Process exited normally' : `Process exited with code ${exitCode}`,
      });
      logger.info(
        {
          exitCode,
          ptyTotalBytes: this.ptyTotalBytes,
          wsFlushCount: this.wsFlushCount,
          wsFlushBytesTotal: this.wsFlushBytesTotal,
          wsMaxPendingBytes: this.wsMaxPendingBytes,
          wsBackpressureEvents: this.wsBackpressureEvents,
        },
        '会话结束',
      );
    });

    this.pty.on('error', (err: Error) => {
      logger.error({ err }, 'PTY 错误');
      this.ws.broadcast({
        type: 'error',
        code: 'pty_error',
        message: err.message,
      });
    });

    // PTY resize 事件（同尺寸已被 PtyManager 内去重）→ 通知所有客户端
    this.pty.on('resize', (cols: number, rows: number) => {
      this.ws.broadcast({ type: 'terminal_resize', cols, rows });
    });
  }

  /**
   * 入队一段 PTY 输出，按三阈值决定是否立即 flush
   */
  private enqueueWsOutput(data: string): void {
    this.wsPendingChunks.push(data);
    this.wsPendingBytes += Buffer.byteLength(data, 'utf8');
    if (this.wsPendingBytes > this.wsMaxPendingBytes) {
      this.wsMaxPendingBytes = this.wsPendingBytes;
    }

    // 高水位线：超过即立即 flush，并记 backpressure
    if (this.wsPendingBytes >= WS_HIGH_WATERMARK_BYTES) {
      this.wsBackpressureEvents++;
      this.flushPendingWsOutput();
      return;
    }

    // 大小阈值：累计达到即 flush
    if (this.wsPendingBytes >= WS_MAX_CHUNK_BYTES) {
      this.flushPendingWsOutput();
      return;
    }

    // 时间窗：还没达到大小阈值就挂个定时器
    if (!this.wsFlushTimer) {
      this.wsFlushTimer = setTimeout(() => {
        this.wsFlushTimer = null;
        this.flushPendingWsOutput();
      }, WS_FLUSH_INTERVAL_MS);
    }
  }

  /**
   * 把 pending 的输出合并成一条 terminal_output 消息广播
   */
  private flushPendingWsOutput(): void {
    if (this.wsFlushTimer) {
      clearTimeout(this.wsFlushTimer);
      this.wsFlushTimer = null;
    }
    if (this.wsPendingChunks.length === 0) return;

    const merged = this.wsPendingChunks.join('');
    const bytes = this.wsPendingBytes;
    this.wsPendingChunks = [];
    this.wsPendingBytes = 0;

    this.wsFlushCount++;
    this.wsFlushBytesTotal += bytes;

    this.ws.broadcast({
      type: 'terminal_output',
      data: merged,
      seq: this.buffer.sequenceNumber,
    });
  }

  // ──────────────── WS → PTY ────────────────

  private wireWs(): void {
    this.ws.onMessage((wsConn: WebSocket, raw: string, type: ClientType) => {
      handleWsMessage(wsConn, raw, {
        onUserInput: (data: string) => {
          // 用户输入：所有客户端类型一律透传到 PTY
          this.pty.write(data);
        },
        onResize: (cols: number, rows: number) => {
          // 主从仲裁：webapp > attach > PC
          //
          // - 有 webapp 在线时：仅 webapp 的 resize 生效，attach 的 resize 被忽略
          //   （webapp 通常是手机/小窗，更需要按它的尺寸渲染）
          // - 仅 attach 在线时：attach 的 resize 生效
          // - 没客户端时：本地 PC 终端通过 TerminalRelay 控制（这里不到达）
          const counts = this.ws.getClientCounts();
          if (counts.webapp > 0 && type === 'attach') {
            logger.debug(
              { type, cols, rows, counts },
              'webapp 在线，attach 的 resize 被忽略',
            );
            return;
          }
          this.pty.resize(cols, rows);
        },
      });
    });

    this.ws.onConnect((wsConn: WebSocket, type: ClientType) => {
      logger.info({ clientType: type }, '新客户端连入，推送 history_sync');
      this.ws.sendTo(wsConn, {
        type: 'history_sync',
        data: this.buffer.getFullContent(),
        seq: this.buffer.sequenceNumber,
        status: this._status,
        cols: this.pty.cols,
        rows: this.pty.rows,
      });
    });

    this.ws.onDisconnect((counts: ClientCounts) => {
      logger.debug(counts, '客户端断开后剩余统计');
      // webapp 全部断开但 attach 仍在 → 广播当前 PTY 尺寸让 attach 重新校准
      // （webapp 在线期间 attach 的 resize 被忽略，可能本地终端尺寸已偏离 PTY 尺寸）
      if (counts.webapp === 0 && counts.attach > 0) {
        this.ws.broadcast({
          type: 'terminal_resize',
          cols: this.pty.cols,
          rows: this.pty.rows,
        });
      }
    });
  }
}

/** 显式标注 IPtyManager 是被 SessionController 使用的接口（阶段 7 多态用到） */
export type { IPtyManager };
