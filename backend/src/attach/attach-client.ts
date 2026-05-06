/**
 * AttachClient
 *
 * `atr attach <url>` 的核心逻辑（解耦 stdin/stdout 让单测可控）。
 *
 * 数据流：
 *   远端 WS terminal_output → emit 'output'（CLI 入口写到 stdout）
 *   外部输入（PC stdin） → write(data) → WS user_input
 *   外部 resize           → resize(cols, rows) → WS resize
 *
 * 重连：连接断开 → 按 ATTACH_RECONNECT_DELAYS_MS 序列退避重连；
 *      重连后服务端会自动 history_sync 让屏幕回到一致状态。
 *
 * 鉴权：URL 中 ?token=<hex>，服务端 WsServer authenticate hook 识别。
 *
 * 不做的事：
 *  - xterm 渲染（attach 直接打到 PC tty，PC 终端自己解析 ANSI）
 *  - 主从仲裁（服务端 SessionController 主导）
 */

import WebSocket from 'ws';
import { EventEmitter } from 'node:events';
import type {
  ServerMessage,
  ClientMessage,
  SessionStatus,
} from '@auvezy/terminal-remote-shared';
import { isServerMessage } from '@auvezy/terminal-remote-shared';
import { logger } from '../logger/logger.js';
import { ATTACH_RECONNECT_DELAYS_MS } from '../constants.js';

export type AttachConnectionStatus = 'connecting' | 'connected' | 'disconnected';

export interface AttachClientEvents {
  /** 终端输出片段（来自 PTY）；CLI 入口写到 stdout */
  output: (data: string) => void;
  /** PTY 尺寸变化（作为附庸时被通知） */
  resize: (cols: number, rows: number) => void;
  /** 服务端会话状态变化 */
  status: (status: SessionStatus, detail?: string) => void;
  /** 连接状态变化 */
  connectionStatus: (s: AttachConnectionStatus) => void;
  /** 服务端报告会话结束 */
  sessionEnded: (exitCode: number, reason: string) => void;
  /** 致命错误（鉴权失败等无法重连的） */
  fatal: (message: string) => void;
}

export interface AttachClientOptions {
  /** 形如 ws://host:port/ws?token=...；http(s) 会被自动改写为 ws(s) */
  url: string;
  /** 重连退避序列；默认 ATTACH_RECONNECT_DELAYS_MS */
  reconnectDelaysMs?: number[];
  /** 自动重连开关（测试可关） */
  autoReconnect?: boolean;
}

/** 把 http(s)://host:port/path?qs 改写成 ws(s)://host:port/ws?qs（保留 token 参数） */
export function normalizeAttachUrl(input: string): string {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error(`无效 URL：${input}`);
  }
  if (url.protocol === 'http:') url.protocol = 'ws:';
  else if (url.protocol === 'https:') url.protocol = 'wss:';
  else if (url.protocol !== 'ws:' && url.protocol !== 'wss:') {
    throw new Error(`不支持的协议：${url.protocol}`);
  }
  url.pathname = '/ws';
  return url.toString();
}

export class AttachClient extends EventEmitter {
  private readonly url: string;
  private readonly reconnectDelays: number[];
  private readonly autoReconnect: boolean;
  private ws: WebSocket | null = null;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;
  private _status: AttachConnectionStatus = 'connecting';

  constructor(opts: AttachClientOptions) {
    super();
    this.url = normalizeAttachUrl(opts.url);
    this.reconnectDelays = opts.reconnectDelaysMs ?? ATTACH_RECONNECT_DELAYS_MS;
    this.autoReconnect = opts.autoReconnect ?? true;
  }

  override emit<K extends keyof AttachClientEvents>(
    event: K,
    ...args: Parameters<AttachClientEvents[K]>
  ): boolean {
    return super.emit(event, ...args);
  }

  override on<K extends keyof AttachClientEvents>(
    event: K,
    listener: AttachClientEvents[K],
  ): this {
    return super.on(event, listener as (...args: unknown[]) => void);
  }

  override once<K extends keyof AttachClientEvents>(
    event: K,
    listener: AttachClientEvents[K],
  ): this {
    return super.once(event, listener as (...args: unknown[]) => void);
  }

  /** 连接（非阻塞；调用方监听事件即可） */
  connect(): void {
    if (this.destroyed) return;
    this.setStatus('connecting');
    const ws = new WebSocket(this.url);
    this.ws = ws;

    ws.on('open', () => {
      this.reconnectAttempt = 0;
      this.setStatus('connected');
      logger.info({ url: this.url }, 'attach WS 已连接');
    });

    ws.on('message', (raw) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw.toString());
      } catch {
        logger.warn('收到非 JSON WS 消息，忽略');
        return;
      }
      if (!isServerMessage(parsed)) {
        logger.warn('收到不识别的 server message，忽略');
        return;
      }
      this.handleServerMessage(parsed);
    });

    ws.on('close', (code) => {
      logger.info({ code }, 'attach WS 关闭');
      this.ws = null;
      this.setStatus('disconnected');
      // 1008 是我们 WsServer 用来表达"鉴权失败/无效请求"的代码
      if (code === 1008 || code === 4401) {
        this.emit('fatal', '认证失败或被服务端拒绝');
        return;
      }
      if (this.autoReconnect && !this.destroyed) {
        this.scheduleReconnect();
      }
    });

    ws.on('error', (err) => {
      logger.warn({ err: err.message }, 'attach WS 错误');
      // close 回调会接着处理重连
    });
  }

  /** 写入用户输入（外部 stdin 喂过来） */
  write(data: string): void {
    this.send({ type: 'user_input', data });
  }

  /** PTY 尺寸调整（外部 SIGWINCH 触发） */
  resize(cols: number, rows: number): void {
    this.send({ type: 'resize', cols, rows });
  }

  /** 关闭连接，停止重连 */
  destroy(): void {
    this.destroyed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      try {
        this.ws.close(1000, 'attach destroy');
      } catch {
        /* ignore */
      }
      this.ws = null;
    }
  }

  get status(): AttachConnectionStatus {
    return this._status;
  }

  // ────────────────── 内部 ──────────────────

  private send(msg: ClientMessage): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    try {
      this.ws.send(JSON.stringify(msg));
    } catch (err) {
      logger.warn({ err: (err as Error).message }, 'WS send 失败');
    }
  }

  private setStatus(s: AttachConnectionStatus): void {
    if (s === this._status) return;
    this._status = s;
    this.emit('connectionStatus', s);
  }

  private handleServerMessage(msg: ServerMessage): void {
    switch (msg.type) {
      case 'terminal_output':
        this.emit('output', msg.data);
        return;
      case 'history_sync':
        // 服务端在新连接时回放：直接写到 stdout 让用户看到当前状态
        this.emit('output', msg.data);
        if (typeof msg.cols === 'number' && typeof msg.rows === 'number') {
          this.emit('resize', msg.cols, msg.rows);
        }
        this.emit('status', msg.status);
        return;
      case 'status_update':
        this.emit('status', msg.status, msg.detail);
        return;
      case 'terminal_resize':
        this.emit('resize', msg.cols, msg.rows);
        return;
      case 'session_ended':
        this.emit('sessionEnded', msg.exitCode, msg.reason);
        return;
      case 'error':
        // 路径性错误（非鉴权）打印到 output 让用户看到
        this.emit('output', `\r\n\x1b[31m[server error: ${msg.code}: ${msg.message}]\x1b[0m\r\n`);
        return;
      case 'heartbeat':
      case 'ip_changed':
        return;
    }
  }

  private scheduleReconnect(): void {
    if (this.destroyed) return;
    const idx = Math.min(this.reconnectAttempt, this.reconnectDelays.length - 1);
    const delay = this.reconnectDelays[idx] ?? 30_000;
    this.reconnectAttempt++;
    logger.info({ attempt: this.reconnectAttempt, delay }, '安排 attach 重连');
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }
}
