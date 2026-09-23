/**
 * input-throttle 单元测试(限速器泛化版)
 *
 * 退格(\x7f 计数)与文本插入(字符串拼接)共用同一队列:60ms 窗口合并、
 * 首键零延迟、数量守恒、跨类型交错天然保序(直接字符串拼接)。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createInputThrottler } from './input-throttle.js';

describe('createInputThrottler', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('首次输入立即发送(单按零延迟)', () => {
    const send = vi.fn();
    const t = createInputThrottler(send, 60);
    t.push('a');
    expect(send).toHaveBeenCalledWith('a');
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('窗口内连打合并:窗口末一条拼接消息', () => {
    const send = vi.fn();
    const t = createInputThrottler(send, 60);
    t.push('a');
    t.push('b');
    t.push('c');
    expect(send).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(60);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenLastCalledWith('bc');
  });

  it('退格与文本混拼:顺序天然保序', () => {
    const send = vi.fn();
    const t = createInputThrottler(send, 60);
    t.push('\x7f'); // 首个立即发
    t.push('\x7f'); // 冷却中,进 pending
    t.push('x');    // 冷却中,拼接
    vi.advanceTimersByTime(60);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenNthCalledWith(1, '\x7f');
    expect(send).toHaveBeenNthCalledWith(2, '\x7fx');
  });

  it('长按字符 repeat(20-30/s):消息频率 ≤ 1/窗口,字符守恒', () => {
    const send = vi.fn();
    const t = createInputThrottler(send, 60);
    for (let i = 0; i < 10; i++) {
      t.push('a');
      vi.advanceTimersByTime(15);
    }
    vi.advanceTimersByTime(60); // 尾批冲出
    expect(send.mock.calls.length).toBeLessThanOrEqual(4);
    const total = send.mock.calls.reduce((n, [s]) => n + s.length, 0);
    expect(total).toBe(10);
  });

  it('flush 保序:挂起输入立刻冲出,冷却窗口继续', () => {
    const send = vi.fn();
    const t = createInputThrottler(send, 60);
    t.push('a');
    t.push('b'); // pending
    t.flush();
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenLastCalledWith('b');
    // flush 算一次发送,冷却继续:紧接的输入进 pending
    send.mockClear();
    t.push('c');
    expect(send).not.toHaveBeenCalled();
    vi.advanceTimersByTime(60);
    expect(send).toHaveBeenCalledWith('c');
  });

  it('窗口冷却后再输入:立即发', () => {
    const send = vi.fn();
    const t = createInputThrottler(send, 60);
    t.push('a');
    vi.advanceTimersByTime(80);
    t.push('b');
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('cancel 丢弃挂起(卸载)', () => {
    const send = vi.fn();
    const t = createInputThrottler(send, 60);
    t.push('a');
    t.push('b');
    t.cancel();
    vi.advanceTimersByTime(120);
    expect(send).toHaveBeenCalledTimes(1);
  });
});
