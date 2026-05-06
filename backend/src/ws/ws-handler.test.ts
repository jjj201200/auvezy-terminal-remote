/**
 * ws-handler 单测
 *
 * 用 mock WebSocket 验证消息分发：合法消息派到对应回调，
 * 非法 / 缺字段 / 未知 type 静默忽略。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WebSocket } from 'ws';
import { handleWsMessage, type WsHandlerCallbacks } from './ws-handler.js';

function makeMockWs(readyState = WebSocket.OPEN): WebSocket & { sentMessages: string[] } {
  const sent: string[] = [];
  return {
    readyState,
    send: (data: string) => sent.push(data),
    sentMessages: sent,
  } as unknown as WebSocket & { sentMessages: string[] };
}

describe('handleWsMessage', () => {
  let cb: WsHandlerCallbacks;

  beforeEach(() => {
    cb = {
      onUserInput: vi.fn(),
      onResize: vi.fn(),
    };
  });

  it('合法 user_input 触发 onUserInput', () => {
    const ws = makeMockWs();
    handleWsMessage(ws, JSON.stringify({ type: 'user_input', data: 'hello' }), cb);
    expect(cb.onUserInput).toHaveBeenCalledWith('hello');
    expect(cb.onResize).not.toHaveBeenCalled();
  });

  it('合法 resize 触发 onResize（带 source ws + master 标志）', () => {
    const ws = makeMockWs();
    handleWsMessage(ws, JSON.stringify({ type: 'resize', cols: 100, rows: 30 }), cb);
    expect(cb.onResize).toHaveBeenCalledWith(100, 30, ws, false);
  });

  it('resize 带 master=true 透传给 onResize', () => {
    const ws = makeMockWs();
    handleWsMessage(
      ws,
      JSON.stringify({ type: 'resize', cols: 100, rows: 30, master: true }),
      cb,
    );
    expect(cb.onResize).toHaveBeenCalledWith(100, 30, ws, true);
  });

  it('heartbeat 直接回包，不触发业务回调', () => {
    const ws = makeMockWs();
    handleWsMessage(ws, JSON.stringify({ type: 'heartbeat', timestamp: 100 }), cb);
    expect(cb.onUserInput).not.toHaveBeenCalled();
    expect(cb.onResize).not.toHaveBeenCalled();
    expect(ws.sentMessages).toHaveLength(1);
    const reply = JSON.parse(ws.sentMessages[0]!);
    expect(reply.type).toBe('heartbeat');
    expect(typeof reply.timestamp).toBe('number');
  });

  it('readyState 不是 OPEN 时 heartbeat 不回包', () => {
    const ws = makeMockWs(WebSocket.CLOSING);
    handleWsMessage(ws, JSON.stringify({ type: 'heartbeat', timestamp: 1 }), cb);
    expect(ws.sentMessages).toHaveLength(0);
  });

  it('非法 JSON 静默忽略', () => {
    const ws = makeMockWs();
    handleWsMessage(ws, 'not-json{{', cb);
    expect(cb.onUserInput).not.toHaveBeenCalled();
    expect(cb.onResize).not.toHaveBeenCalled();
  });

  it('user_input 缺 data 字段忽略', () => {
    const ws = makeMockWs();
    handleWsMessage(ws, JSON.stringify({ type: 'user_input' }), cb);
    expect(cb.onUserInput).not.toHaveBeenCalled();
  });

  it('user_input data 不是字符串忽略', () => {
    const ws = makeMockWs();
    handleWsMessage(ws, JSON.stringify({ type: 'user_input', data: 123 }), cb);
    expect(cb.onUserInput).not.toHaveBeenCalled();
  });

  it('resize 缺字段忽略', () => {
    const ws = makeMockWs();
    handleWsMessage(ws, JSON.stringify({ type: 'resize', cols: 100 }), cb);
    expect(cb.onResize).not.toHaveBeenCalled();
  });

  it('resize 字段类型错误忽略', () => {
    const ws = makeMockWs();
    handleWsMessage(ws, JSON.stringify({ type: 'resize', cols: '80', rows: '24' }), cb);
    expect(cb.onResize).not.toHaveBeenCalled();
  });

  it('未知 type 静默忽略', () => {
    const ws = makeMockWs();
    handleWsMessage(ws, JSON.stringify({ type: 'mystery_type', data: 'x' }), cb);
    expect(cb.onUserInput).not.toHaveBeenCalled();
    expect(cb.onResize).not.toHaveBeenCalled();
  });
});
