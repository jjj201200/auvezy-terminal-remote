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
import type { ServerMessage } from 'auvezy-terminal-remote-shared';
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

  broadcast(msg: ServerMessage, exclude?: { has(ws: WebSocket): boolean }): void {
    this.broadcasts.push(msg);
    this.lastBroadcastExclude = exclude ?? null;
  }
  /** 最近一次 broadcast 的排除集合（history_sync 顺序保证的断言用） */
  lastBroadcastExclude: { has(ws: WebSocket): boolean } | null = null;
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

  it('客户端连入推送 history_sync（grid 序列化流）', async () => {
    pty.emit('data', 'hello\n');
    // 客户端连入
    const wsClient = {} as WebSocket;
    ws.fireConnect(wsClient, 'webapp');
    // serialize 需等 headless 解析队列 flush（异步），让出事件循环
    await new Promise((r) => setTimeout(r, 20));
    const sent = ws.directSends.find((s) => s.ws === wsClient && s.msg.type === 'history_sync');
    expect(sent).toBeTruthy();
    if (sent && sent.msg.type === 'history_sync') {
      // serialize 输出是重建的转义流（含光标定位），不再是原始字节——文本内容保留
      expect(sent.msg.data).toContain('hello');
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

  it('seq 在 history_sync 中是当前 write 计数', async () => {
    pty.emit('data', 'a');
    pty.emit('data', 'b');
    pty.emit('data', 'c');
    const wsClient = {} as WebSocket;
    ws.fireConnect(wsClient);
    await new Promise((r) => setTimeout(r, 20));
    const hs = ws.directSends.find((s) => s.msg.type === 'history_sync');
    expect(hs).toBeTruthy();
    if (hs?.msg.type === 'history_sync') {
      expect(hs.msg.seq).toBe(3); // 3 次 write
    }
  });

  it('history_sync 送达前该客户端被排除在 terminal_output 广播外', async () => {
    const wsClient = {} as WebSocket;
    ws.fireConnect(wsClient, 'webapp');
    // serialize 尚未完成时来了一段大输出（超阈值立即 flush）→ broadcast 应携带排除集合
    pty.emit('data', 'x'.repeat(WS_MAX_CHUNK_BYTES + 1));
    const out = ws.broadcasts.find((b) => b.type === 'terminal_output');
    expect(out).toBeTruthy();
    expect(ws.lastBroadcastExclude?.has(wsClient)).toBe(true);
    await new Promise((r) => setTimeout(r, 20));
    // 送达后解除排除
    expect(ws.lastBroadcastExclude?.has(wsClient)).toBeFalsy();
    const hs = ws.directSends.find((s) => s.ws === wsClient && s.msg.type === 'history_sync');
    expect(hs).toBeTruthy();
  });
});

// ──────────────── pendingApprovals 生命周期(0.7.4 修)────────────────
//
// 用户按 ESC 中断审批时,claude code 不发 PostToolUseFailure(那条 hook 只在
// 工具真正 invoke 后才会触发,审批前的 ESC 在 PreToolUse 之前就取消了),
// 但**会**发 Stop → turn_ended。所以 turn_ended / turn_failed 必须清
// pendingApprovals,否则 webapp 卡在 'waiting_input' 永远不释放。
//
// 同步覆盖 0.7.4 加的 ESC 两阶段取消机制(observeUserInputForCancel)。

/** SessionController 只用 IntegrationManager 的 EventEmitter('event') 接口 */
class FakeIntegrationManager extends EventEmitter {
  activeId = 'claude-code';
}

interface StatusSnapshot {
  type: 'status_update';
  status: string;
  pendingApprovals?: number;
  pendingCancelRequested?: boolean;
  pendingApprovalTools?: string[];
}

describe('SessionController pendingApprovals 生命周期', () => {
  let ws: MockWs;
  let ctrl: SessionController;
  let manager: FakeIntegrationManager;

  beforeEach(() => {
    ws = new MockWs();
    ctrl = new SessionController(
      new MockPty() as unknown as PtyManager,
      ws as unknown as never,
      1000,
      { writeToProcessStdout: false },
    );
    manager = new FakeIntegrationManager();
    ctrl.setStatus('running');
    ctrl.setIntegrationManager(manager as never);
  });

  afterEach(() => {
    ctrl.destroy();
  });

  function lastStatus(): StatusSnapshot {
    const updates = ws.broadcasts.filter((m) => m.type === 'status_update');
    return updates[updates.length - 1] as StatusSnapshot;
  }
  /** 模拟前端发来的 user_input ws 消息 */
  function sendInput(data: string): void {
    ws.fireMessage({} as WebSocket, JSON.stringify({ type: 'user_input', data }));
  }

  it('approval_pending → status=waiting_input', () => {
    manager.emit('event', { kind: 'approval_pending', id: 'a1', tool: 'Bash', detail: 'ls' });
    const last = lastStatus();
    expect(last.status).toBe('waiting_input');
    expect(last.pendingApprovals).toBe(1);
  });

  it('ESC 中断:approval_pending → turn_ended 必须清空 pending,status 回 running', () => {
    manager.emit('event', { kind: 'approval_pending', id: 'a1', tool: 'Bash', detail: 'rm -rf /' });
    expect(lastStatus().status).toBe('waiting_input');
    // 用户按 ESC → claude 取消 turn,不会发 PostToolUseFailure,只发 Stop
    manager.emit('event', { kind: 'turn_ended' });
    const after = lastStatus();
    expect(after.status).toBe('running');
    expect(after.pendingApprovals).toBe(0);
  });

  it('turn_failed 也清 pending(API 错误等场景)', () => {
    manager.emit('event', { kind: 'approval_pending', id: 'a1', tool: 'Edit' });
    manager.emit('event', { kind: 'approval_pending', id: 'a2', tool: 'Bash' });
    expect(lastStatus().pendingApprovals).toBe(2);
    manager.emit('event', { kind: 'turn_failed', errorKind: 'rate_limit', detail: '429' });
    const after = lastStatus();
    // turn_failed 不改 base(仍 running),仅设 lastError + 清 pending
    expect(after.pendingApprovals).toBe(0);
    expect(after.status).toBe('running');
  });

  it('user_prompt 兜底:ESC 跳过审批 + 用户提交新 prompt → 即时清 pending', () => {
    // 用户 ESC 后 claude 不发 PostToolUseFailure / Stop;但下一轮 prompt 提交
    // 触发 UserPromptSubmit → user_prompt event,清掉 stuck pending。
    manager.emit('event', { kind: 'approval_pending', id: 'a1', tool: 'Bash', detail: 'rm /tmp/x' });
    expect(lastStatus().status).toBe('waiting_input');
    manager.emit('event', { kind: 'user_prompt', text: '换个任务做' });
    const after = lastStatus();
    expect(after.status).toBe('running');
    expect(after.pendingApprovals).toBe(0);
  });

  it('正常完成路径:approval_pending → approval_resolved → 不依赖 turn_ended 也能清', () => {
    manager.emit('event', { kind: 'approval_pending', id: 'a1', tool: 'Bash' });
    expect(lastStatus().status).toBe('waiting_input');
    manager.emit('event', { kind: 'approval_resolved', id: 'a1', outcome: 'allow' });
    const after = lastStatus();
    expect(after.status).toBe('running');
    expect(after.pendingApprovals).toBe(0);
  });

  // ──────────────── ESC 两阶段取消 ────────────────

  it('ESC 阶段 1:awaiting + ESC → cancel_requested=true, 状态仍 waiting_input', () => {
    manager.emit('event', { kind: 'approval_pending', id: 'a1', tool: 'Bash' });
    sendInput('\x1b');
    const after = lastStatus();
    expect(after.status).toBe('waiting_input');
    expect(after.pendingCancelRequested).toBe(true);
    expect(after.pendingApprovals).toBe(1);
  });

  it('ESC 阶段 2:cancel_requested + 非 ESC 输入 → 清 pending,回 running', () => {
    manager.emit('event', { kind: 'approval_pending', id: 'a1', tool: 'Bash' });
    sendInput('\x1b');
    expect(lastStatus().pendingCancelRequested).toBe(true);
    sendInput('h');
    const after = lastStatus();
    expect(after.status).toBe('running');
    expect(after.pendingApprovals).toBe(0);
    expect(after.pendingCancelRequested).toBe(false);
  });

  it('连按 ESC 不重复清(保持 cancel_requested,等真正稳态信号)', () => {
    manager.emit('event', { kind: 'approval_pending', id: 'a1', tool: 'Bash' });
    sendInput('\x1b');
    sendInput('\x1b');
    sendInput('\x1b');
    const after = lastStatus();
    expect(after.status).toBe('waiting_input');
    expect(after.pendingCancelRequested).toBe(true);
    expect(after.pendingApprovals).toBe(1);
  });

  it('非 awaiting 状态下 ESC 不触发(vim/htop 日常按 ESC 误判防护)', () => {
    sendInput('\x1b');
    const after = lastStatus();
    expect(after.status).toBe('running');
    expect(after.pendingCancelRequested).toBeFalsy();
  });

  it('cancel_requested 后 hook approval_resolved 到达,也是稳态确认', () => {
    manager.emit('event', { kind: 'approval_pending', id: 'a1', tool: 'Bash' });
    sendInput('\x1b');
    expect(lastStatus().pendingCancelRequested).toBe(true);
    // claude 内部其实把 ESC 当作 deny → 真 hook 来了
    manager.emit('event', { kind: 'approval_resolved', id: 'a1', outcome: 'deny' });
    const after = lastStatus();
    expect(after.status).toBe('running');
    expect(after.pendingApprovals).toBe(0);
    expect(after.pendingCancelRequested).toBe(false);
  });
});
