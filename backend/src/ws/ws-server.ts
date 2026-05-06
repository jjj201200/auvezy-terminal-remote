/**
 * WsServer
 *
 * WebSocket 服务端，封装连接管理、心跳、消息分发。
 *
 * 关键设计：
 * - 用 ws 库的 noServer 模式：自己挂 HTTP server 的 'upgrade' 事件
 *   只响应 pathname === '/ws' 的 upgrade 请求，其它直接 destroy
 * - 客户端类型分 webapp / attach 两种（阶段 1 全是 webapp，阶段 7 启用 attach）
 *   类型在 upgrade 时确定，存入 WeakMap<IncomingMessage, ClientType>
 *   WeakMap 自动 GC 不需要手工清理
 * - 三个外部 hook（onMessage/onConnect/onDisconnect）解耦"网络层"与"业务层"
 *   业务层（SessionController）负责：history_sync 推送、主从仲裁、PTY 写入
 * - 心跳用原生 ping/pong：30s 周期 ping，下一轮没收到 pong 就 terminate
 *   timer 用 unref() 避免阻塞 process.exit
 * - broadcast 序列化一次后循环发送，避免重复 JSON.stringify
 * - 阶段 1 不启用认证，AuthModule 是可选注入，阶段 2 接入
 */

import type { Server as HttpServer, IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, WebSocket } from 'ws';
import {
  WS_HEARTBEAT_INTERVAL_MS,
  MAX_WS_MESSAGE_SIZE,
  type ServerMessage,
} from '@auvezy/terminal-remote-shared';
import { logger } from '../logger/logger.js';

/** 客户端类型：webapp 是主控，attach 是从控（阶段 7 启用） */
export type ClientType = 'webapp' | 'attach';

interface ClientEntry {
  ws: WebSocket;
  alive: boolean;
  clientType: ClientType;
}

/** 客户端数量按类型统计 */
export interface ClientCounts {
  webapp: number;
  attach: number;
}

/** WsServer 的可选注入点（阶段 2 起注入 AuthModule） */
export interface WsServerOptions {
  /** 自定义 upgrade 鉴权钩子（返回 ClientType 表示通过，null 表示拒绝） */
  authenticate?: (req: IncomingMessage) => ClientType | null;
}

export class WsServer {
  private readonly wss: WebSocketServer;
  private readonly clients = new Set<ClientEntry>();
  private readonly upgradeTypes = new WeakMap<IncomingMessage, ClientType>();
  private heartbeatTimer: NodeJS.Timeout | null = null;

  private messageHandler: ((ws: WebSocket, raw: string, type: ClientType) => void) | null = null;
  // onConnect / onDisconnect 升级为多 listener，多个独立模块（SessionController +
  // index.ts 的 spawn 触发器）需要同时监听新连接事件
  private readonly connectHandlers: Array<(ws: WebSocket, type: ClientType) => void> = [];
  private readonly disconnectHandlers: Array<(counts: ClientCounts) => void> = [];

  constructor(
    private readonly httpServer: HttpServer,
    private readonly opts: WsServerOptions = {},
  ) {
    this.wss = new WebSocketServer({
      noServer: true,
      maxPayload: MAX_WS_MESSAGE_SIZE,
    });
    this.setupUpgrade();
    this.setupConnection();
    this.startHeartbeat();
  }

  // ──────────────── 外部 hook 注入 ────────────────

  onMessage(fn: (ws: WebSocket, raw: string, type: ClientType) => void): void {
    this.messageHandler = fn;
  }

  /** 注册新连接 listener；可重复调用，多 listener 独立触发 */
  onConnect(fn: (ws: WebSocket, type: ClientType) => void): void {
    this.connectHandlers.push(fn);
  }

  /** 注册断开 listener；可重复调用 */
  onDisconnect(fn: (counts: ClientCounts) => void): void {
    this.disconnectHandlers.push(fn);
  }

  // ──────────────── 客户端统计 ────────────────

  get clientCount(): number {
    return this.clients.size;
  }

  getClientCounts(): ClientCounts {
    let webapp = 0;
    let attach = 0;
    for (const c of this.clients) {
      if (c.clientType === 'attach') attach++;
      else webapp++;
    }
    return { webapp, attach };
  }

  // ──────────────── 发送 ────────────────

  /** 广播到所有连接的客户端 */
  broadcast(msg: ServerMessage): void {
    const payload = JSON.stringify(msg);
    for (const c of this.clients) {
      if (c.ws.readyState === WebSocket.OPEN) {
        c.ws.send(payload);
      }
    }
  }

  /** 发送给指定 WebSocket */
  sendTo(ws: WebSocket, msg: ServerMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }

  // ──────────────── 关闭 ────────────────

  destroy(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    for (const c of this.clients) {
      c.ws.terminate();
    }
    this.clients.clear();
    this.wss.close();
  }

  // ──────────────── 内部：upgrade 路径鉴权 ────────────────

  private setupUpgrade(): void {
    this.httpServer.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
      // 只响应 /ws 路径
      let pathname = '/';
      try {
        const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
        pathname = url.pathname;
      } catch {
        socket.destroy();
        return;
      }
      if (pathname !== '/ws') {
        socket.destroy();
        return;
      }

      // 鉴权：阶段 1 默认全部当作 webapp 通过
      const clientType = this.opts.authenticate
        ? this.opts.authenticate(req)
        : 'webapp';

      if (clientType === null) {
        logger.warn({ url: req.url }, 'WS upgrade 被鉴权拒绝');
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }

      this.upgradeTypes.set(req, clientType);
      this.wss.handleUpgrade(req, socket, head, (ws) => {
        this.wss.emit('connection', ws, req);
      });
    });
  }

  // ──────────────── 内部：connection 处理 ────────────────

  private setupConnection(): void {
    this.wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
      const clientType = this.upgradeTypes.get(req) ?? 'webapp';
      const entry: ClientEntry = { ws, alive: true, clientType };
      this.clients.add(entry);

      logger.info(
        { total: this.clients.size, clientType },
        'WS 客户端已连接',
      );

      ws.on('pong', () => {
        entry.alive = true;
      });

      ws.on('message', (raw) => {
        if (this.messageHandler) {
          this.messageHandler(ws, raw.toString(), clientType);
        }
      });

      const removeAndNotify = (): void => {
        if (this.clients.delete(entry)) {
          const counts = this.getClientCounts();
          logger.info({ total: this.clients.size, ...counts }, 'WS 客户端已断开');
          for (const fn of this.disconnectHandlers) fn(counts);
        }
      };

      ws.on('close', removeAndNotify);
      ws.on('error', (err) => {
        logger.warn({ err, clientType }, 'WS 客户端错误');
        removeAndNotify();
      });

      for (const fn of this.connectHandlers) fn(ws, clientType);
    });
  }

  // ──────────────── 内部：心跳 ────────────────

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      for (const c of this.clients) {
        if (!c.alive) {
          logger.info('心跳超时，terminate 无响应客户端');
          c.ws.terminate();
          this.clients.delete(c);
          continue;
        }
        c.alive = false;
        c.ws.ping();
      }
    }, WS_HEARTBEAT_INTERVAL_MS);
    // 不阻塞 process exit
    if (typeof this.heartbeatTimer.unref === 'function') {
      this.heartbeatTimer.unref();
    }
  }
}
