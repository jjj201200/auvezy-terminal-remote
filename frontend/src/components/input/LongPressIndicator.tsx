/**
 * LongPressIndicator
 *
 * 移动端长按视觉反馈：在触摸点正上方显示一根细进度条，从 0 增长到 100%
 * 表示长按倒计时进行中。仅在 useTouchSwipeScroll hook 通过 onLongPressStart
 * 显式打开时才渲染。
 *
 * - fixed 定位，用 viewport 坐标，不受容器变换 / 滚动影响
 * - pointer-events:none，不拦截任何手势
 * - duration 由调用方传入（一般 = longPressMs - progressDelayMs）
 */

import type { JSX } from 'react';
import s from './LongPressIndicator.module.scss';

export interface LongPressIndicatorProps {
  /** 触摸点 viewport 坐标 */
  x: number;
  y: number;
  /** 进度条满需多久（ms） */
  durationMs: number;
}

export function LongPressIndicator({ x, y, durationMs }: LongPressIndicatorProps): JSX.Element {
  return (
    <div
      // key 让每次重新出现都会重置 CSS animation
      key={`${x}-${y}`}
      className={s.root}
      style={{ left: x - 40, top: y - 36 }}
    >
      <div className={s.bar} style={{ animationDuration: `${durationMs}ms` }} />
    </div>
  );
}
