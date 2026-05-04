/**
 * RateLimiter 单测
 *
 * 用 fake timers 控制时间窗，覆盖：
 * - 窗口内累计计数
 * - 超限拒绝
 * - 窗口过期开新窗
 * - reset 清零
 * - remaining 返回正确剩余
 * - 多 IP 独立计数
 * - 构造参数校验
 * - destroy 清理 timer
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RateLimiter } from './rate-limiter.js';

describe('RateLimiter', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: 1_000_000 });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('构造参数校验', () => {
    expect(() => new RateLimiter(0)).toThrow();
    expect(() => new RateLimiter(-1)).toThrow();
    expect(() => new RateLimiter(1.5)).toThrow();
  });

  it('窗口内未超限都通过', () => {
    const rl = new RateLimiter(5);
    for (let i = 0; i < 5; i++) {
      expect(rl.attempt('1.2.3.4')).toBe(true);
    }
    rl.destroy();
  });

  it('超过 maxAttempts 拒绝', () => {
    const rl = new RateLimiter(3);
    expect(rl.attempt('ip')).toBe(true);
    expect(rl.attempt('ip')).toBe(true);
    expect(rl.attempt('ip')).toBe(true);
    expect(rl.attempt('ip')).toBe(false);
    expect(rl.attempt('ip')).toBe(false);
    rl.destroy();
  });

  it('窗口过期后开新窗', () => {
    const rl = new RateLimiter(2, 60_000);
    expect(rl.attempt('ip')).toBe(true);
    expect(rl.attempt('ip')).toBe(true);
    expect(rl.attempt('ip')).toBe(false);

    // 推进 60s+1ms，应该开新窗口
    vi.advanceTimersByTime(60_001);
    expect(rl.attempt('ip')).toBe(true);
    expect(rl.attempt('ip')).toBe(true);
    expect(rl.attempt('ip')).toBe(false);
    rl.destroy();
  });

  it('reset 清零某 IP', () => {
    const rl = new RateLimiter(2);
    rl.attempt('ip');
    rl.attempt('ip');
    expect(rl.attempt('ip')).toBe(false);

    rl.reset('ip');
    expect(rl.attempt('ip')).toBe(true);
    expect(rl.attempt('ip')).toBe(true);
    expect(rl.attempt('ip')).toBe(false);
    rl.destroy();
  });

  it('remaining 返回正确剩余', () => {
    const rl = new RateLimiter(3);
    expect(rl.remaining('ip')).toBe(3);
    rl.attempt('ip');
    expect(rl.remaining('ip')).toBe(2);
    rl.attempt('ip');
    expect(rl.remaining('ip')).toBe(1);
    rl.attempt('ip');
    expect(rl.remaining('ip')).toBe(0);
    // 超限后还是 0
    rl.attempt('ip');
    expect(rl.remaining('ip')).toBe(0);
    rl.destroy();
  });

  it('窗口过期后 remaining 返回满额', () => {
    const rl = new RateLimiter(3, 60_000);
    rl.attempt('ip');
    rl.attempt('ip');
    expect(rl.remaining('ip')).toBe(1);

    vi.advanceTimersByTime(60_001);
    expect(rl.remaining('ip')).toBe(3);
    rl.destroy();
  });

  it('多 IP 独立计数', () => {
    const rl = new RateLimiter(2);
    expect(rl.attempt('a')).toBe(true);
    expect(rl.attempt('a')).toBe(true);
    expect(rl.attempt('a')).toBe(false);

    // b 仍有满额
    expect(rl.attempt('b')).toBe(true);
    expect(rl.attempt('b')).toBe(true);
    expect(rl.attempt('b')).toBe(false);
    rl.destroy();
  });

  it('destroy 幂等', () => {
    const rl = new RateLimiter(2);
    expect(() => {
      rl.destroy();
      rl.destroy();
    }).not.toThrow();
  });
});
