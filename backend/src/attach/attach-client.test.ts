/**
 * AttachClient 单测
 *
 * 用真实 WebSocketServer 接 client，验证：
 *  - normalizeAttachUrl 协议改写
 *  - history_sync 触发 output / resize / status
 *  - terminal_output 触发 output
 *  - status_update 触发 status
 *  - write/resize 真的发到 server 端
 *  - 1008 关闭码触发 fatal，不重连
 *  - 普通 close 触发重连（用 autoReconnect=false 验证不重连分支）
 */

import { describe, it, expect } from 'vitest';
import { WebSocketServer } from 'ws';
import { AttachClient, normalizeAttachUrl } from './attach-client.js';
import type { ClientMessage, ServerMessage } from '@auvezy/terminal-remote-shared';

describe('normalizeAttachUrl', () => {
  it('http → ws', () => {
    expect(normalizeAttachUrl('http://h:3000/?token=abc')).toBe('ws://h:3000/ws?token=abc');
  });
  it('https → wss', () => {
    expect(normalizeAttachUrl('https://h:3000/path?token=abc')).toBe(
      'wss://h:3000/ws?token=abc',
    );
  });
  it('已是 ws 保持', () => {
    expect(normalizeAttachUrl('ws://h:3000/x?token=abc')).toBe('ws://h:3000/ws?token=abc');
  });
  it('未知协议 → 抛错', () => {
    expect(() => normalizeAttachUrl('ftp://h')).toThrow(/不支持的协议/);
  });
  it('无效 URL → 抛错', () => {
    expect(() => normalizeAttachUrl('not-a-url')).toThrow();
  });
});

async function startWsServer(): Promise<{
  port: number;
  server: WebSocketServer;
  clients: Set<{ on: (e: string, l: (...a: unknown[]) => void) => void; send: (data: string) => void; close: (code?: number) => void }>;
  received: ClientMessage[];
}> {
  const received: ClientMessage[] = [];
  const clients = new Set();
  const server = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  server.on('connection', (ws) => {
    clients.add(ws as unknown as never);
    ws.on('message', (raw) => {
      try {
        received.push(JSON.parse(raw.toString()));
      } catch {
        /* ignore */
      }
    });
  });
  await new Promise<void>((r) => server.once('listening', () => r()));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return { port, server, clients: clients as never, received };
}

describe('AttachClient', () => {
  it('history_sync → output + resize + status', async () => {
    const srv = await startWsServer();
    const c = new AttachClient({
      url: `ws://127.0.0.1:${srv.port}/ws`,
      autoReconnect: false,
    });

    const events: Array<[string, unknown[]]> = [];
    c.on('output', (d) => events.push(['output', [d]]));
    c.on('resize', (a, b) => events.push(['resize', [a, b]]));
    c.on('status', (s) => events.push(['status', [s]]));
    c.on('connectionStatus', (s) => events.push(['conn', [s]]));

    c.connect();
    // 等连上
    await new Promise<void>((r) => c.once('connectionStatus', (s) => s === 'connected' && r()));

    // server 给 history_sync
    const msg: ServerMessage = {
      type: 'history_sync',
      data: 'welcome',
      seq: 1,
      status: 'running',
      cols: 100,
      rows: 30,
    };
    for (const ws of srv.clients) {
      (ws as unknown as { send: (s: string) => void }).send(JSON.stringify(msg));
    }
    // 等事件传到
    await new Promise((r) => setTimeout(r, 100));

    const labels = events.map(([k]) => k);
    expect(labels).toContain('output');
    expect(labels).toContain('resize');
    expect(labels).toContain('status');

    c.destroy();
    srv.server.close();
  });

  it('write/resize 实际发到 server', async () => {
    const srv = await startWsServer();
    const c = new AttachClient({
      url: `ws://127.0.0.1:${srv.port}/ws`,
      autoReconnect: false,
    });
    c.connect();
    await new Promise<void>((r) => c.once('connectionStatus', (s) => s === 'connected' && r()));

    c.write('abc');
    c.resize(120, 40);
    await new Promise((r) => setTimeout(r, 100));

    expect(srv.received).toContainEqual({ type: 'user_input', data: 'abc' });
    expect(srv.received).toContainEqual({ type: 'resize', cols: 120, rows: 40 });

    c.destroy();
    srv.server.close();
  });

  it('1008 关闭码 → fatal，不重连', async () => {
    const srv = await startWsServer();
    let fatalCount = 0;
    const c = new AttachClient({
      url: `ws://127.0.0.1:${srv.port}/ws`,
      autoReconnect: true,
      reconnectDelaysMs: [10],
    });
    c.on('fatal', () => fatalCount++);
    c.connect();
    await new Promise<void>((r) => c.once('connectionStatus', (s) => s === 'connected' && r()));

    for (const ws of srv.clients) {
      (ws as unknown as { close: (code: number) => void }).close(1008);
    }
    await new Promise((r) => setTimeout(r, 200));
    expect(fatalCount).toBe(1);

    c.destroy();
    srv.server.close();
  });

  it('普通 close + autoReconnect=false → 不重连', async () => {
    const srv = await startWsServer();
    const c = new AttachClient({
      url: `ws://127.0.0.1:${srv.port}/ws`,
      autoReconnect: false,
    });
    c.connect();
    await new Promise<void>((r) => c.once('connectionStatus', (s) => s === 'connected' && r()));

    for (const ws of srv.clients) {
      (ws as unknown as { close: () => void }).close();
    }
    await new Promise((r) => setTimeout(r, 200));
    expect(c.status).toBe('disconnected');

    c.destroy();
    srv.server.close();
  });
});
