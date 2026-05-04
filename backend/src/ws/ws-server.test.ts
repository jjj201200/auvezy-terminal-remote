/**
 * WsServer 集成测试
 *
 * 起真实 HTTP server + 真实 WebSocket 客户端，验证：
 * - upgrade 路径鉴权（pathname 必须 /ws）
 * - authenticate hook 拒绝时返回 401 后 destroy
 * - onConnect / onMessage / onDisconnect 回调被正确触发
 * - broadcast / sendTo 正确投递
 * - getClientCounts 按类型分组
 * - destroy 清理所有连接
 *
 * 测试结束所有 server 必须关闭，端口必须释放（CLAUDE.md 第一条规则）
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocket } from 'ws';
import { WsServer, type ClientType } from './ws-server.js';

/** 等待一个事件，带超时 */
function waitFor<T>(setup: (resolve: (v: T) => void) => void, ms = 2000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`等待事件超时 (${ms}ms)`)), ms);
    setup((v) => {
      clearTimeout(timer);
      resolve(v);
    });
  });
}

/** 等待 WS 连接打开 */
function openWs(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const timer = setTimeout(() => reject(new Error('WS open 超时')), 2000);
    ws.once('open', () => {
      clearTimeout(timer);
      resolve(ws);
    });
    ws.once('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

/** 关闭一个 WS 客户端等待 close 事件 */
function closeWs(ws: WebSocket): Promise<void> {
  return new Promise((resolve) => {
    if (ws.readyState === WebSocket.CLOSED) return resolve();
    ws.once('close', () => resolve());
    ws.close();
  });
}

describe('WsServer', () => {
  let httpServer: HttpServer;
  let wsServer: WsServer;
  let port: number;

  beforeEach(async () => {
    httpServer = createServer();
    await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
    port = (httpServer.address() as AddressInfo).port;
  });

  afterEach(async () => {
    if (wsServer) wsServer.destroy();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  });

  it('/ws 路径连接成功，触发 onConnect', async () => {
    wsServer = new WsServer(httpServer);
    const connected = await waitFor<ClientType>((resolve) => {
      wsServer.onConnect((_ws, type) => resolve(type));
      void openWs(`ws://127.0.0.1:${port}/ws`);
    });
    expect(connected).toBe('webapp');
    expect(wsServer.clientCount).toBe(1);
  });

  it('非 /ws 路径连接被拒绝', async () => {
    wsServer = new WsServer(httpServer);
    await expect(openWs(`ws://127.0.0.1:${port}/wrong`)).rejects.toThrow();
    expect(wsServer.clientCount).toBe(0);
  });

  it('authenticate 返回 null 时返回 401', async () => {
    wsServer = new WsServer(httpServer, { authenticate: () => null });
    await expect(openWs(`ws://127.0.0.1:${port}/ws`)).rejects.toThrow();
    expect(wsServer.clientCount).toBe(0);
  });

  it('authenticate 决定 ClientType', async () => {
    wsServer = new WsServer(httpServer, { authenticate: () => 'attach' });
    const type = await waitFor<ClientType>((resolve) => {
      wsServer.onConnect((_ws, t) => resolve(t));
      void openWs(`ws://127.0.0.1:${port}/ws`);
    });
    expect(type).toBe('attach');
  });

  it('客户端发消息触发 onMessage', async () => {
    wsServer = new WsServer(httpServer);
    const connectPromise = waitFor<void>((resolve) => {
      wsServer.onConnect(() => resolve());
    });
    const ws = await openWs(`ws://127.0.0.1:${port}/ws`);
    await connectPromise;

    const msg = await waitFor<string>((resolve) => {
      wsServer.onMessage((_ws, raw) => resolve(raw));
      ws.send('hello-from-client');
    });
    expect(msg).toBe('hello-from-client');

    await closeWs(ws);
  });

  it('断开触发 onDisconnect 并更新 counts', async () => {
    wsServer = new WsServer(httpServer);
    const connectPromise = waitFor<void>((resolve) => {
      wsServer.onConnect(() => resolve());
    });
    const ws = await openWs(`ws://127.0.0.1:${port}/ws`);
    await connectPromise;

    const counts = await waitFor<{ webapp: number; attach: number }>((resolve) => {
      wsServer.onDisconnect((c) => resolve(c));
      ws.close();
    });
    expect(counts.webapp).toBe(0);
    expect(wsServer.clientCount).toBe(0);
  });

  it('broadcast 投递到所有客户端', async () => {
    wsServer = new WsServer(httpServer);
    const ws1 = await openWs(`ws://127.0.0.1:${port}/ws`);
    const ws2 = await openWs(`ws://127.0.0.1:${port}/ws`);
    await new Promise((r) => setTimeout(r, 50)); // 等 onConnect 完成

    const recv1 = waitFor<string>((resolve) => {
      ws1.once('message', (data) => resolve(data.toString()));
    });
    const recv2 = waitFor<string>((resolve) => {
      ws2.once('message', (data) => resolve(data.toString()));
    });

    wsServer.broadcast({
      type: 'terminal_output',
      data: 'hi',
      seq: 1,
    });

    const [m1, m2] = await Promise.all([recv1, recv2]);
    expect(JSON.parse(m1).data).toBe('hi');
    expect(JSON.parse(m2).data).toBe('hi');

    await closeWs(ws1);
    await closeWs(ws2);
  });

  it('getClientCounts 按类型分组', async () => {
    let typeIdx = 0;
    const types: ClientType[] = ['webapp', 'attach', 'webapp'];
    wsServer = new WsServer(httpServer, {
      authenticate: () => types[typeIdx++] ?? 'webapp',
    });

    const ws1 = await openWs(`ws://127.0.0.1:${port}/ws`);
    const ws2 = await openWs(`ws://127.0.0.1:${port}/ws`);
    const ws3 = await openWs(`ws://127.0.0.1:${port}/ws`);
    await new Promise((r) => setTimeout(r, 50));

    const counts = wsServer.getClientCounts();
    expect(counts.webapp).toBe(2);
    expect(counts.attach).toBe(1);

    await closeWs(ws1);
    await closeWs(ws2);
    await closeWs(ws3);
  });

  it('destroy 关闭所有连接', async () => {
    wsServer = new WsServer(httpServer);
    const ws = await openWs(`ws://127.0.0.1:${port}/ws`);
    await new Promise((r) => setTimeout(r, 50));
    expect(wsServer.clientCount).toBe(1);

    const closed = waitFor<void>((resolve) => {
      ws.once('close', () => resolve());
    });
    wsServer.destroy();
    await closed;
    expect(wsServer.clientCount).toBe(0);
  });
});
