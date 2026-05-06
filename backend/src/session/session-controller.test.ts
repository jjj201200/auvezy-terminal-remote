/**
 * SessionController 单测
 *
 * 用 mock PtyManager（EventEmitter 子类）+ stub WsServer 验证：
 * - PTY data → 三向分发
 * - WS 输出批合并的 16ms 时间窗
 * - 高水位线触发立即 flush 并计 backpressure
 * - 新客户端 onConnect 立即收到 history_sync
 * - PTY exit 触发 session_ended 广播 + flush 剩余
 * - PTY resize 广播 terminal_resize
 * - 用户输入透传到 PTY.write
 * - 客户端 resize 透传到 PTY.resize
 *
 * mock 设计：
 * - mockPty 继承 EventEmitter，模拟 4 事件
 * - mockWs 实现 broadcast / sendTo / onConnect / onMessage / onDisconnect 接口
 *   收发记录到数组便于断言
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import type { ServerMessage } from '@auvezy/terminal-remote-shared';
import type { WebSocket } from 'ws';
import type { ClientType, ClientCounts, WsServer } from '../ws/ws-server.js';
import { SessionController } from './session-controller.js';
import { PtyManager } from '../pty/pty-manager.js';
import {
  WS_FLUSH_INTERVAL_MS,
  WS_MAX_CHUNK_BYTES,
  WS_HIGH_WATERMARK_BYTES,
} from '../constants.js';

class MockPty extends EventEmitter {
  cols = 80;
  rows = 24;
  writeCalls: string[] = [];
  resizeCalls: Array<[number, number]> = [];
  write(data: string): void {
    this.writeCalls.push(data);
  }
  resize(cols: number, rows: number): void {
    this.resizeCalls.push([cols, rows]);
  }
}

class MockWs {
  broadcasts: ServerMessage[] = [];
  directSends: Array<{ ws: WebSocket; msg: ServerMessage }> = [];
  private msgHandler: ((ws: WebSocket, raw: string, t: ClientType) => void) | null = null;
  private connectHandler: ((ws: WebSocket, t: ClientType) => void) | null = null;
  private disconnectHandler: ((counts: ClientCounts) => void) | null = null;

  clientCount = 0;
  /** 测试可写：当前客户端类型分布；阶段 7 主从仲裁要用 */
  counts: ClientCounts = { webapp: 0, attach: 0 };

  getClientCounts(): ClientCounts {
    return this.counts;
  }

  onMessage(fn: (ws: WebSocket, raw: string, t: ClientType) => void): void {
    this.msgHandler = fn;
  }
  onConnect(fn: (ws: WebSocket, t: ClientType) => void): void {
    this.connectHandler = fn;
  }
  onDisconnect(fn: (counts: ClientCounts) => void): void {
    this.disconnectHandler = fn;
  }

  broadcast(msg: ServerMessage): void {
    this.broadcasts.push(msg);
  }
  sendTo(ws: WebSocket, msg: ServerMessage): void {
    this.directSends.push({ ws, msg });
  }

  /** 测试辅助：模拟客户端连入 */
  fireConnect(ws: WebSocket, type: ClientType = 'webapp'): void {
    this.clientCount++;
    if (type === 'attach') this.counts.attach++;
    else this.counts.webapp++;
    this.connectHandler?.(ws, type);
  }
  /** 测试辅助：模拟客户端发消息 */
  fireMessage(ws: WebSocket, raw: string, type: ClientType = 'webapp'): void {
    this.msgHandler?.(ws, raw, type);
  }
  /** 测试辅助：模拟客户端断开 */
  fireDisconnect(counts: ClientCounts = { webapp: 0, attach: 0 }): void {
    this.clientCount = Math.max(0, this.clientCount - 1);
    this.disconnectHandler?.(counts);
  }
}

describe('SessionController', () => {
  let pty: MockPty;
  let ws: MockWs;
  let ctrl: SessionController;

  beforeEach(() => {
    pty = new MockPty();
    ws = new MockWs();
    // 用 unknown 双重断言绕过类型检查（仅测试用）
    ctrl = new SessionController(
      pty as unknown as PtyManager,
      ws as unknown as never,
      1000,
      { writeToProcessStdout: false }, // 测试时不污染 stdout
    );
  });

  afterEach(() => {
    ctrl.destroy();
    vi.useRealTimers();
  });

  it('初始 status=pty_pending、connectedClients=0', () => {
    expect(ctrl.status).toBe('pty_pending');
    expect(ctrl.connectedClients).toBe(0);
  });

  it('setStatus 广播 status_update', () => {
    ctrl.setStatus('running');
    const last = ws.broadcasts[ws.broadcasts.length - 1];
    expect(last?.type).toBe('status_update');
    if (last?.type === 'status_update') expect(last.status).toBe('running');
  });

  it('setStatus 带 detail 时附加', () => {
    ctrl.setStatus('waiting_input', '等待审批');
    const last = ws.broadcasts[ws.broadcasts.length - 1];
    if (last?.type === 'status_update') expect(last.detail).toBe('等待审批');
  });

  it('PTY data 触发 16ms 时间窗 flush', async () => {
    vi.useFakeTimers();
    pty.emit('data', 'hello');
    expect(ws.broadcasts.length).toBe(0); // 还没到 16ms

    vi.advanceTimersByTime(WS_FLUSH_INTERVAL_MS);
    expect(ws.broadcasts.length).toBe(1);
    const out = ws.broadcasts[0];
    if (out?.type === 'terminal_output') {
      expect(out.data).toBe('hello');
      expect(out.seq).toBeGreaterThan(0);
    }
  });

  it('多次 PTY data 在窗口内合并', async () => {
    vi.useFakeTimers();
    pty.emit('data', 'a');
    pty.emit('data', 'b');
    pty.emit('data', 'c');
    expect(ws.broadcasts.length).toBe(0);

    vi.advanceTimersByTime(WS_FLUSH_INTERVAL_MS);
    expect(ws.broadcasts.length).toBe(1);
    const out = ws.broadcasts[0];
    if (out?.type === 'terminal_output') {
      expect(out.data).toBe('abc');
    }
  });

  it('达到 WS_MAX_CHUNK_BYTES 立即 flush 不等时间窗', () => {
    const big = 'x'.repeat(WS_MAX_CHUNK_BYTES + 1);
    pty.emit('data', big);
    // 立即 flush，不需要 fake timer
    expect(ws.broadcasts.length).toBe(1);
  });

  it('达到 WS_HIGH_WATERMARK_BYTES 触发 backpressure 计数', () => {
    const big = 'x'.repeat(WS_HIGH_WATERMARK_BYTES + 1);
    pty.emit('data', big);
    expect(ws.broadcasts.length).toBe(1);
    // backpressure 计数体现在 PTY exit 日志，外部不可见，所以这里只验证立即 flush
  });

  it('客户端连入推送 history_sync', () => {
    pty.emit('data', 'hello\n');
    // 客户端连入
    const wsClient = {} as WebSocket;
    ws.fireConnect(wsClient, 'webapp');
    const sent = ws.directSends.find((s) => s.ws === wsClient && s.msg.type === 'history_sync');
    expect(sent).toBeTruthy();
    if (sent && sent.msg.type === 'history_sync') {
      expect(sent.msg.data).toBe('hello\n');
      expect(sent.msg.cols).toBe(80);
      expect(sent.msg.rows).toBe(24);
      // 默认未 spawn → pty_pending
      expect(sent.msg.status).toBe('pty_pending');
    }
  });

  it('PTY exit 触发 session_ended 并 flush 剩余', () => {
    vi.useFakeTimers();
    pty.emit('data', 'last data');
    pty.emit('exit', 0);

    // exit 应触发 flush（不依赖时间窗）
    const ended = ws.broadcasts.find((b) => b.type === 'session_ended');
    const out = ws.broadcasts.find((b) => b.type === 'terminal_output');
    expect(out).toBeTruthy();
    expect(ended).toBeTruthy();
    if (ended?.type === 'session_ended') {
      expect(ended.exitCode).toBe(0);
      expect(ended.reason).toContain('normally');
    }
    expect(ctrl.status).toBe('idle');
  });

  it('PTY exit 非 0 退出 reason 含 exit code', () => {
    pty.emit('exit', 137);
    const ended = ws.broadcasts.find((b) => b.type === 'session_ended');
    if (ended?.type === 'session_ended') {
      expect(ended.exitCode).toBe(137);
      expect(ended.reason).toContain('137');
    }
  });

  it('PTY error 广播 error 消息', () => {
    pty.emit('error', new Error('炸了'));
    const err = ws.broadcasts.find((b) => b.type === 'error');
    expect(err).toBeTruthy();
    if (err?.type === 'error') {
      expect(err.message).toBe('炸了');
      expect(err.code).toBe('pty_error');
    }
  });

  it('PTY resize 事件广播 terminal_resize', () => {
    pty.emit('resize', 100, 30);
    const ev = ws.broadcasts.find((b) => b.type === 'terminal_resize');
    expect(ev).toBeTruthy();
    if (ev?.type === 'terminal_resize') {
      expect(ev.cols).toBe(100);
      expect(ev.rows).toBe(30);
    }
  });

  it('客户端 user_input 透传到 PTY.write', () => {
    const wsClient = {} as WebSocket;
    ws.fireMessage(wsClient, JSON.stringify({ type: 'user_input', data: 'ls\n' }));
    expect(pty.writeCalls).toEqual(['ls\n']);
  });

  it('客户端 resize 透传到 PTY.resize（仅 webapp 在线场景）', () => {
    const wsClient = {} as WebSocket;
    ws.counts = { webapp: 1, attach: 0 };
    ws.fireMessage(wsClient, JSON.stringify({ type: 'resize', cols: 120, rows: 40 }));
    expect(pty.resizeCalls).toEqual([[120, 40]]);
  });

  it('阶段 7 主从仲裁：webapp 在线时 attach 的 resize 被忽略', () => {
    const wsClient = {} as WebSocket;
    ws.counts = { webapp: 1, attach: 1 };
    ws.fireMessage(
      wsClient,
      JSON.stringify({ type: 'resize', cols: 120, rows: 40 }),
      'attach',
    );
    expect(pty.resizeCalls).toEqual([]); // 被忽略
  });

  it('阶段 7 主从仲裁：仅 attach 在线时 attach 的 resize 生效', () => {
    const wsClient = {} as WebSocket;
    ws.counts = { webapp: 0, attach: 1 };
    ws.fireMessage(
      wsClient,
      JSON.stringify({ type: 'resize', cols: 88, rows: 24 }),
      'attach',
    );
    expect(pty.resizeCalls).toEqual([[88, 24]]);
  });

  it('阶段 7 主从仲裁：webapp 全断 attach 在 → 广播 terminal_resize', () => {
    pty.cols = 100;
    pty.rows = 30;
    ws.broadcasts.length = 0;
    ws.fireDisconnect({ webapp: 0, attach: 1 });
    const tr = ws.broadcasts.find((m) => m.type === 'terminal_resize');
    expect(tr).toBeTruthy();
    if (tr?.type === 'terminal_resize') {
      expect(tr.cols).toBe(100);
      expect(tr.rows).toBe(30);
    }
  });

  it('客户端非法消息不抛错', () => {
    const wsClient = {} as WebSocket;
    expect(() => {
      ws.fireMessage(wsClient, 'garbage{{');
    }).not.toThrow();
    expect(pty.writeCalls).toEqual([]);
  });

  it('seq 在 history_sync 中是当前 buffer 的 seq', () => {
    pty.emit('data', 'a');
    pty.emit('data', 'b');
    pty.emit('data', 'c');
    const wsClient = {} as WebSocket;
    ws.fireConnect(wsClient);
    const hs = ws.directSends.find((s) => s.msg.type === 'history_sync');
    if (hs?.msg.type === 'history_sync') {
      expect(hs.msg.seq).toBe(3); // 3 次 append
    }
  });
});

describe('SessionController + AnsiFilter（阶段 8）', () => {
  it('alt-screen 内容默认被过滤，不进 buffer 也不广播', async () => {
    const { SessionController } = await import('./session-controller.js');
    const pty2 = new MockPty();
    const ws2 = new MockWs();
    const ctrl = new SessionController(
      pty2 as unknown as PtyManager,
      ws2 as unknown as WsServer,
      100,
      { writeToProcessStdout: false },
    );

    pty2.emit('data', 'before-alt');
    pty2.emit('data', '\x1b[?1049h'); // enter alt
    pty2.emit('data', 'inside-alt');
    pty2.emit('data', '\x1b[?1049l'); // exit alt
    pty2.emit('data', 'after-alt');

    // 强制 flush 任何 pending（destroy 内部会 flush）
    ctrl.destroy();

    // 把所有 broadcast 的 terminal_output 内容拼起来
    const out = ws2.broadcasts
      .filter((m) => m.type === 'terminal_output')
      .map((m) => (m.type === 'terminal_output' ? m.data : ''))
      .join('');
    // 应该不含 'inside-alt'
    expect(out).not.toContain('inside-alt');
    // 应该含 enter/exit 序列与正常文本
    expect(out).toContain('before-alt');
    expect(out).toContain('after-alt');
    expect(out).toContain('\x1b[?1049h');
    expect(out).toContain('\x1b[?1049l');
  });

  it('ansiFilter=false 时不过滤', async () => {
    const { SessionController } = await import('./session-controller.js');
    const pty2 = new MockPty();
    const ws2 = new MockWs();
    const ctrl = new SessionController(
      pty2 as unknown as PtyManager,
      ws2 as unknown as WsServer,
      100,
      { writeToProcessStdout: false, ansiFilter: false },
    );

    pty2.emit('data', '\x1b[?1049h');
    pty2.emit('data', 'inside');
    pty2.emit('data', '\x1b[?1049l');
    ctrl.destroy();

    const out = ws2.broadcasts
      .filter((m) => m.type === 'terminal_output')
      .map((m) => (m.type === 'terminal_output' ? m.data : ''))
      .join('');
    expect(out).toContain('inside'); // 关闭过滤后保留
  });
});
