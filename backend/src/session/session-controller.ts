/**
 * SessionController
 *
 * 系统的核心协调器:把 PTY、WsServer、OutputBuffer、IntegrationManager 这些独立模块
 * 编织成一个完整的会话流。它本身不直接调用 node-pty 或 ws 库,而是通过依赖注入
 * 接收已构造好的实例,便于测试与扩展。
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

import { WebSocket } from 'ws';
import type { SessionStatus, SessionStatusExtras } from 'auvezy-terminal-remote-shared';
import type { IPtyManager } from '../pty/types.js';
import { PtyManager } from '../pty/pty-manager.js';
import { OutputBuffer } from '../pty/output-buffer.js';
import { WsServer, type ClientType, type ClientCounts } from '../ws/ws-server.js';
import { handleWsMessage } from '../ws/ws-handler.js';
import { AnsiFilter } from '../utils/ansi-filter.js';
import type { PushService } from '../push/push-service.js';
import { logger } from '../logger/logger.js';
import type { IntegrationManager } from '../integrations/manager.js';
import type { IntegrationEvent } from '../integrations/types.js';
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
  //
  // 状态分两层:
  //  - _baseStatus: PTY 进程级状态(pty_pending / running / idle)。SessionController
  //    在 PTY 启动 / 退出时维护
  //  - 富状态(pendingApprovals / activeTool / lastError 等):由 IntegrationManager
  //    上报的 IntegrationEvent 维护
  //
  // 对外暴露的 SessionStatus 是两层派生:有 pendingApprovals → 'waiting_input';
  // 否则 = _baseStatus。这保证旧客户端逻辑不变,同时新客户端可看到 extras 全量字段。
  private _baseStatus: SessionStatus = 'pty_pending';
  /** 进行中的审批,key = approval id(同一 id 多次 pending 仅记一次) */
  private readonly pendingApprovals: Map<string, { tool: string; since: number }> = new Map();
  /** 当前进行中的工具调用(LIFO,最后一条 tool_started 为准) */
  private activeTool: { tool: string; summary: string; since: number; toolUseId: string } | null = null;
  /** 最近一次 turn_failed,UI 红色 banner 用 */
  private lastError: { kind: string; detail?: string; at: number } | null = null;
  /** Stop 携带的 last_assistant_message,可用于推送正文 */
  private lastAssistantMessage: string | null = null;

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

  /** Integration 事件源(替换原 HookReceiver) */
  private integrations: IntegrationManager | null = null;

  /**
   * PTY 尺寸主控连接：声明 master=true 的客户端 WebSocket 引用。
   * 仅它能改 PTY cols/rows；其他客户端的 resize 被忽略。断开时自动释放
   * （onDisconnect 处理）。null = 无主控，先到先得
   */
  private masterClient: WebSocket | null = null;

  /** ANSI 过滤器（阶段 8 启用；null = 关闭过滤直接透传） */
  private readonly ansiFilter: AnsiFilter | null;

  /** 可选的 PushService（阶段 9 启用；用于 hook 触发时推送通知） */
  private pushService: PushService | null = null;
  /** 实例显示名 + 端口（用于推送 payload；阶段 9 启用） */
  private pushContext: { instanceName: string; url: string } | null = null;

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
   * 注入 IntegrationManager
   *
   * 替换原 setHookReceiver。manager 已在外部完成 register + prepareSpawn,
   * 此处只订阅 'event' 把 IntegrationEvent 喂进状态机。
   *
   * 多次调用 = 替换(旧 manager 的 listener 自动随其 shutdown 清掉),允许在
   * 配置切换时重建。
   */
  setIntegrationManager(manager: IntegrationManager): void {
    if (this.integrations) {
      logger.warn('SessionController.setIntegrationManager 重复调用,覆盖旧 manager');
    }
    this.integrations = manager;
    manager.on('event', (e: IntegrationEvent) => this.onIntegrationEvent(e));
  }

  /**
   * 注入 PushService（阶段 9）
   *
   * @param push    PushService 实例（应已 init）
   * @param context 实例标识，用于推送 payload 中的 title/url
   */
  setPushService(push: PushService, context: { instanceName: string; url: string }): void {
    this.pushService = push;
    this.pushContext = context;
  }

  /**
   * 消费 Integration 事件 → 维护富状态 → 派发 status_update + 推送通知
   *
   * 设计要点:
   *  - 所有富状态变更都最终走 broadcastStatus(),保证派生 SessionStatus 与 extras 同步
   *  - 同一审批的 pending/resolved 用 id 精确配对(LIFO 仅在 id 缺失时兜底)
   *  - turn_failed 后 lastError 保留;下次 turn_started/tool_started 时清除——避免
   *    红色 banner 永远不消失
   */
  private onIntegrationEvent(e: IntegrationEvent): void {
    logger.debug({ event: e }, 'integration event');
    let pushTitle: string | null = null;
    let pushBody: string | null = null;

    switch (e.kind) {
      case 'approval_pending': {
        // 同 id 重复 pending 不重复入队;新 id = 真正多审批并发
        if (!this.pendingApprovals.has(e.id)) {
          this.pendingApprovals.set(e.id, { tool: e.tool, since: Date.now() });
        }
        pushTitle = 'Claude 等待审批';
        pushBody = e.detail ?? `工具:${e.tool}`;
        break;
      }
      case 'approval_resolved': {
        if (this.pendingApprovals.has(e.id)) {
          this.pendingApprovals.delete(e.id);
        } else {
          // id 不在 pending 集合里 → 可能是 PostToolUse 配对的 pending:<tool> 兜底,
          // 或 Notification 没发就直接到了 PostToolUse(用户手动配置 hook 时可能漏)。
          // LIFO 兜底:删最后一条同工具的 pending(如果有)
          this.popLastApprovalByPrefix(e.id);
        }
        break;
      }
      case 'tool_started': {
        // 新工具开始 = 上一次的 lastError 清掉(成功的进展遮掉历史失败)
        this.lastError = null;
        this.activeTool = {
          tool: e.tool,
          summary: e.summary,
          since: Date.now(),
          toolUseId: e.toolUseId,
        };
        break;
      }
      case 'tool_finished': {
        // 仅在 toolUseId 与当前 active 匹配时清掉;否则可能是别的并发工具结束
        if (this.activeTool?.toolUseId === e.toolUseId) {
          this.activeTool = null;
        }
        break;
      }
      case 'turn_started': {
        this.lastError = null;
        break;
      }
      case 'turn_ended': {
        // 一轮结束 = 清空 activeTool(残留 active 通常是 hook 漏发的边界情况)
        this.activeTool = null;
        if (e.lastMessage) this.lastAssistantMessage = e.lastMessage;
        break;
      }
      case 'turn_failed': {
        this.lastError = { kind: e.errorKind, ...(e.detail ? { detail: e.detail } : {}), at: Date.now() };
        this.activeTool = null;
        // rate_limit / billing_error 等需要用户立即关注 → 推送
        pushTitle = `Claude turn 失败:${e.errorKind}`;
        pushBody = e.detail ?? e.errorKind;
        break;
      }
      case 'session_event': {
        // 暂时只用日志;若未来要在 UI 显示"刚恢复了昨天会话"可加字段
        logger.info({ phase: e.phase, detail: e.detail }, 'session event');
        break;
      }
      case 'cwd_changed':
      case 'user_prompt': {
        // 这些事件目前不影响状态机;留给未来 UI 用。user_prompt 显式不进推送(隐私)
        break;
      }
    }

    this.broadcastStatus();

    if (pushTitle && this.pushService && this.pushContext) {
      const ctx = this.pushContext;
      const title = `[${ctx.instanceName}] ${pushTitle}`;
      void this.pushService
        .notifyAll({ title, body: pushBody ?? '', url: ctx.url })
        .catch((err) => logger.warn({ err }, '推送 integration 通知失败'));
    }
  }

  /** approval id 不在集合中时,按"工具名前缀"删除最后一条同工具 pending */
  private popLastApprovalByPrefix(_id: string): void {
    // 当前 deriveApprovalId 在缺 tool_use_id 时返回 'pending:<tool>',若 PostToolUse 带
    // tool_use_id 而 Notification 没带 → id 不一致。这里只能粗略按 LIFO 删最后一条
    if (this.pendingApprovals.size === 0) return;
    const lastKey = Array.from(this.pendingApprovals.keys()).pop();
    if (lastKey) this.pendingApprovals.delete(lastKey);
  }

  /**
   * 派发 status_update,从富状态派生 SessionStatus + extras 一并广播
   *
   * 派生规则:
   *  - pty_pending / idle:base 直接透出
   *  - pendingApprovals.size > 0:'waiting_input'(含义:用户该去看终端处理审批)
   *  - 否则:base(running)
   */
  private broadcastStatus(): void {
    const derived = this.deriveStatus();
    const extras = this.buildStatusExtras();
    this.ws.broadcast({
      type: 'status_update',
      status: derived,
      ...extras,
    });
  }

  private deriveStatus(): SessionStatus {
    if (this._baseStatus === 'pty_pending' || this._baseStatus === 'idle') {
      return this._baseStatus;
    }
    if (this.pendingApprovals.size > 0) return 'waiting_input';
    return 'running';
  }

  private buildStatusExtras(): SessionStatusExtras {
    const tools = Array.from(this.pendingApprovals.values()).map((v) => v.tool);
    return {
      integrationId: this.integrations?.activeId ?? null,
      activeTool: this.activeTool?.summary ?? null,
      pendingApprovals: this.pendingApprovals.size,
      pendingApprovalTools: tools,
      lastError: this.lastError,
      lastAssistantMessage: this.lastAssistantMessage,
    };
  }

  // ──────────────── 公共 API ────────────────

  get status(): SessionStatus {
    return this.deriveStatus();
  }

  get connectedClients(): number {
    return this.ws.clientCount;
  }

  /**
   * 主动设置 base 状态并广播
   *
   * 用于 PTY 启动后 pty_pending → running、PTY 退出 running → idle 等"硬切换"。
   * 若调用者传 'waiting_input',会被自动派生覆盖回去——审批状态是富状态派生,
   * 不接受外部直接 setStatus('waiting_input')。
   */
  setStatus(status: SessionStatus, detail?: string): void {
    if (status === 'waiting_input') {
      logger.warn('setStatus(waiting_input) 被忽略;审批状态由 IntegrationEvent 派生');
      return;
    }
    this._baseStatus = status;
    const extras = this.buildStatusExtras();
    this.ws.broadcast({
      type: 'status_update',
      status: this.deriveStatus(),
      ...(detail ? { detail } : {}),
      ...extras,
    });
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
      this._baseStatus = 'idle';
      // PTY 退出 = 工具调用 / 审批全部失效;清空状态避免悬空
      this.activeTool = null;
      this.pendingApprovals.clear();
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

    // alt-screen 状态切换 → 广播给前端
    // 前端用此状态决定 touch 滚动是"翻方向键"还是让 xterm 走原生 scrollback
    this.pty.on('altScreenChange', (inAltScreen: boolean) => {
      this.ws.broadcast({ type: 'alt_screen_change', inAltScreen });
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
        onResize: (cols: number, rows: number, source: WebSocket, master?: boolean) => {
          // 仲裁规则（按顺序）：
          //  1. 主控声明（master=true）—— 最高优先级。任何客户端（webapp /
          //     attach 都可以）声明都立即接管。这必须覆盖客户端类型仲裁，因为
          //     通过不同 IP / Tailscale / 跨子网访问的浏览器也会被识别为 attach
          //     （只有同源 cookie 鉴权的才是 webapp）
          //  2. 当前有主控且非自己 → 忽略此 resize（避免多端互相覆盖尺寸：
          //     PC ResizeObserver 反复发宽 cols 会冲掉手机的窄 cols）
          //  3. 客户端类型仲裁：webapp > attach。仅在没有主控时生效，让本地
          //     CLI attach 不会覆盖浏览器 webapp 设定的尺寸
          //  4. 主控释放：master 连接断开 → 自动释放（onDisconnect 处理）
          const counts = this.ws.getClientCounts();
          if (master) {
            this.masterClient = source;
            logger.info({ cols, rows, type }, 'PTY 主控切换：客户端声明 master');
            this.pty.resize(cols, rows);
            return;
          }
          if (this.masterClient && this.masterClient !== source) {
            logger.debug({ cols, rows }, '主控被其他客户端持有，忽略此 resize');
            return;
          }
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
        status: this.deriveStatus(),
        ...this.buildStatusExtras(),
        cols: this.pty.cols,
        rows: this.pty.rows,
      });
      // 重连时若 PTY 当前在 alt-screen（如 Claude/vim 已运行），也要把状态告诉
      // 客户端——否则客户端默认 inAltScreen=false，swipe 路径走错（不会接管为
      // PgUp/PgDn）
      if (this.pty.inAltScreen) {
        this.ws.sendTo(wsConn, {
          type: 'alt_screen_change',
          inAltScreen: true,
        });
      }
    });

    this.ws.onDisconnect((counts: ClientCounts) => {
      logger.debug(counts, '客户端断开后剩余统计');
      // 主控释放：如果当前主控连接已经不 OPEN，清掉它，下个 resize 自动接管
      if (this.masterClient && this.masterClient.readyState !== WebSocket.OPEN) {
        logger.info('PTY 主控连接已断开，释放主控锁');
        this.masterClient = null;
      }
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
