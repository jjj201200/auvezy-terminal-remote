/**
 * RateLimiter
 *
 * per-IP 滑动窗口式限流器，每分钟一个新窗口，达到上限拒绝。
 *
 * 设计：
 * - 内存 Map<ip, { count, resetAt }>
 * - 周期清理（2× window）avoid 长期不退出场景下内存膨胀
 * - cleanupTimer 用 unref 避免阻塞 process exit
 *
 * 多实例语义（重要权衡）：
 * - 各实例独立计数，不跨进程共享
 * - 同 IP 在多实例下有效尝试数 = maxAttempts × 实例数
 * - token 256 bit 暴力穷举不可行，因此可接受这个权衡
 */

import { logger } from '../logger/logger.js';

interface Entry {
  count: number;
  /** 当前窗口结束时间戳（绝对时间，毫秒） */
  resetAt: number;
}

export class RateLimiter {
  private readonly entries = new Map<string, Entry>();
  private readonly maxAttempts: number;
  private readonly windowMs: number;
  private cleanupTimer: NodeJS.Timeout | null = null;

  /**
   * @param maxAttempts 窗口内最大允许次数
   * @param windowMs   窗口长度（毫秒），默认 60s
   */
  constructor(maxAttempts: number, windowMs: number = 60_000) {
    if (!Number.isInteger(maxAttempts) || maxAttempts <= 0) {
      throw new Error('RateLimiter: maxAttempts 必须是正整数');
    }
    this.maxAttempts = maxAttempts;
    this.windowMs = windowMs;

    // 周期清理过期 entry
    this.cleanupTimer = setInterval(() => this.cleanup(), windowMs * 2);
    if (typeof this.cleanupTimer.unref === 'function') {
      this.cleanupTimer.unref();
    }
  }

  /**
   * 尝试一次请求，自动累加计数
   *
   * @returns true 通过 / false 已超限被拒
   */
  attempt(ip: string): boolean {
    const now = Date.now();
    const entry = this.entries.get(ip);

    if (!entry || now >= entry.resetAt) {
      // 首次或窗口已过期：开新窗口
      this.entries.set(ip, { count: 1, resetAt: now + this.windowMs });
      return true;
    }

    entry.count++;
    if (entry.count > this.maxAttempts) {
      logger.warn(
        { ip, count: entry.count, max: this.maxAttempts },
        '认证速率超限',
      );
      return false;
    }
    return true;
  }

  /** 当前窗口内剩余次数 */
  remaining(ip: string): number {
    const now = Date.now();
    const entry = this.entries.get(ip);
    if (!entry || now >= entry.resetAt) return this.maxAttempts;
    return Math.max(0, this.maxAttempts - entry.count);
  }

  /**
   * 重置某 IP 的计数（认证成功后清零）
   *
   * 让合法用户不会因为之前误输导致后续尝试被限流
   */
  reset(ip: string): void {
    this.entries.delete(ip);
  }

  /** 清理过期 entry（避免内存膨胀） */
  private cleanup(): void {
    const now = Date.now();
    for (const [ip, entry] of this.entries) {
      if (now >= entry.resetAt) {
        this.entries.delete(ip);
      }
    }
  }

  /** 销毁定时器 */
  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }
}
