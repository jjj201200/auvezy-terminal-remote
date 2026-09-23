/**
 * backspace-throttle 单元测试
 *
 * 连按退格(键盘 repeat 20-30 次/秒)时把 \x7f 发送频率压到 15-20 次/秒:
 * 窗口内多次退格合并为一条 '\x7f'×N 消息,数量守恒、首键立即、跨内容保序。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createBackspaceThrottler } from './backspace-throttle.js';

describe('createBackspaceThrottler', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('首次退格立即发送(单按无延迟)', () => {
    const send = vi.fn();
    const t = createBackspaceThrottler(send, 60);
    t.push(1);
    expect(send).toHaveBeenCalledWith('\x7f');
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('窗口内连按合并:第二条延迟到窗口末,数量守恒', () => {
    const send = vi.fn();
    const t = createBackspaceThrottler(send, 60);
    t.push(1); // 立即
    t.push(1); // pending
    t.push(1); // pending 合并
    expect(send).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(60);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenLastCalledWith('\x7f\x7f'); // 2 次合并一条
  });

  it('连续长按:消息频率不超过 1/窗口(10 次退格 ≤ 2 条消息 in 60ms 窗口)', () => {
    const send = vi.fn();
    const t = createBackspaceThrottler(send, 60);
    for (let i = 0; i < 10; i++) {
      t.push(1);
      vi.advanceTimersByTime(15); // 模拟键盘 repeat 间隔
    }
    // 尾批还在冷却窗内,冲完再统计
    vi.advanceTimersByTime(60);
    // 10 次 × 15ms = 150ms,理论消息数 ≤ ceil(150/60)+1 = 4
    expect(send.mock.calls.length).toBeLessThanOrEqual(4);
    // 总退格数守恒:10
    const total = send.mock.calls.reduce((n, [s]) => n + s.length, 0);
    expect(total).toBe(10);
  });

  it('flush 保序:退格挂起时插入文本先冲刷 pending 再发', () => {
    const send = vi.fn();
    const t = createBackspaceThrottler(send, 60);
    t.push(1);
    t.push(1); // pending
    t.flush();
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenLastCalledWith('\x7f'); // pending 冲出
    // flush 本身算一次发送,冷却窗口继续:紧接着再按进 pending 而非立即发
    send.mockClear();
    t.push(1);
    expect(send).not.toHaveBeenCalled();
    vi.advanceTimersByTime(60);
    expect(send).toHaveBeenCalledWith('\x7f');
  });

  it('窗口冷却后再按:立即发,不延迟', () => {
    const send = vi.fn();
    const t = createBackspaceThrottler(send, 60);
    t.push(1);
    vi.advanceTimersByTime(80); // 超过窗口
    t.push(1);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('cancel 丢弃挂起(卸载场景)', () => {
    const send = vi.fn();
    const t = createBackspaceThrottler(send, 60);
    t.push(1);
    t.push(1);
    t.cancel();
    vi.advanceTimersByTime(120);
    expect(send).toHaveBeenCalledTimes(1); // pending 被丢弃
  });
});
