/**
 * useTouchSwipeScroll 纯函数单测
 *
 * 这里只测纯函数:normalizeWheelDelta / isWheelDirectionReversed /
 * drainWheelAccum。React hook 本身的 effect / event listener 流不在此覆盖
 * (需要 jsdom + 模拟 WheelEvent + rAF 推进,代价远超价值)。
 *
 * 这三个纯函数是 onWheel 累计逻辑的"算法骨架",覆盖它们等价于覆盖
 * mac 触摸板"一拨手指 = 几行"的核心修复点。
 */

import { describe, it, expect } from 'vitest';
import {
  normalizeWheelDelta,
  isWheelDirectionReversed,
  drainWheelAccum,
} from './useTouchSwipeScroll.js';

describe('normalizeWheelDelta', () => {
  it('deltaMode=0 (PIXEL) 直通', () => {
    expect(normalizeWheelDelta(50, 0, 800)).toBe(50);
    expect(normalizeWheelDelta(-30, 0, 800)).toBe(-30);
    expect(normalizeWheelDelta(0, 0, 800)).toBe(0);
  });

  it('deltaMode=1 (LINE) × 16', () => {
    expect(normalizeWheelDelta(3, 1, 800)).toBe(48);
    expect(normalizeWheelDelta(-1, 1, 800)).toBe(-16);
  });

  it('deltaMode=2 (PAGE) × viewportHeight × 0.8', () => {
    expect(normalizeWheelDelta(1, 2, 800)).toBe(640);
    expect(normalizeWheelDelta(-0.5, 2, 1000)).toBe(-400);
  });
});

describe('isWheelDirectionReversed', () => {
  it('反向 → true', () => {
    expect(isWheelDirectionReversed(1, -1)).toBe(true);
    expect(isWheelDirectionReversed(-1, 1)).toBe(true);
  });

  it('同向 → false', () => {
    expect(isWheelDirectionReversed(1, 1)).toBe(false);
    expect(isWheelDirectionReversed(-1, -1)).toBe(false);
  });

  it('prev=0(初次)→ false(无方向可比)', () => {
    expect(isWheelDirectionReversed(0, 1)).toBe(false);
    expect(isWheelDirectionReversed(0, -1)).toBe(false);
  });

  it('new=0(deltaY 是 0)→ false(不该清累计)', () => {
    expect(isWheelDirectionReversed(1, 0)).toBe(false);
    expect(isWheelDirectionReversed(-1, 0)).toBe(false);
  });
});

describe('drainWheelAccum', () => {
  it('累计 < 阈值 → 无 tick,remaining = 原值', () => {
    const r = drainWheelAccum(20, 40);
    expect(r.ticks).toEqual([]);
    expect(r.remaining).toBe(20);
  });

  it('累计 ≥ 阈值正向 → 65(down),余量留下', () => {
    const r = drainWheelAccum(50, 40);
    expect(r.ticks).toEqual([65]);
    expect(r.remaining).toBe(10);
  });

  it('累计 ≥ 阈值负向 → 64(up)', () => {
    const r = drainWheelAccum(-50, 40);
    expect(r.ticks).toEqual([64]);
    expect(r.remaining).toBe(-10);
  });

  it('累计为阈值整倍数 → 多个 tick,余量 0', () => {
    const r = drainWheelAccum(120, 40);
    expect(r.ticks).toEqual([65, 65, 65]);
    expect(r.remaining).toBe(0);
  });

  it('刚好等于阈值 → 1 个 tick + 0 余量', () => {
    const r = drainWheelAccum(40, 40);
    expect(r.ticks).toEqual([65]);
    expect(r.remaining).toBe(0);
  });

  it('阈值 0 / 负 → 防御性清零,无 tick', () => {
    expect(drainWheelAccum(100, 0)).toEqual({ remaining: 0, ticks: [] });
    expect(drainWheelAccum(100, -10)).toEqual({ remaining: 0, ticks: [] });
  });

  it('阈值 NaN / Infinity → 防御性清零', () => {
    expect(drainWheelAccum(100, NaN)).toEqual({ remaining: 0, ticks: [] });
    expect(drainWheelAccum(100, Infinity)).toEqual({ remaining: 0, ticks: [] });
  });

  // mac 触摸板典型场景:cellHeight=18,med 敏感度(mult=1)→ 阈值 18px
  // 一拨手指总 deltaY = 240px(连续 20+ 个 ~12px 小事件累计) → 应发 13 行
  it('mac 触摸板典型一拨(累计 240px,阈值 18)→ 13 个 tick + 余 6', () => {
    const r = drainWheelAccum(240, 18);
    expect(r.ticks).toHaveLength(13);
    expect(r.ticks.every((b) => b === 65)).toBe(true);
    expect(r.remaining).toBeCloseTo(6, 5);
  });

  // 同样 240px,low 敏感度(mult=2)→ 阈值 36px → 6 个 tick + 余 24
  it('低敏感度场景(同样 240px,阈值 36)→ 6 个 tick', () => {
    const r = drainWheelAccum(240, 36);
    expect(r.ticks).toHaveLength(6);
    expect(r.remaining).toBeCloseTo(24, 5);
  });
});
