/**
 * useTouchSwipeScroll
 *
 * 移动端在 alt-screen TUI（claude / vim / htop / tmux 等）里手指滑动 = 翻方向键。
 *
 * 为什么需要：
 *   alt-screen 程序完全接管屏幕，xterm 的原生 scrollback 被锁，touch swipe 没人接，
 *   用户在 Claude 里只能呆呆看屏幕没法翻 history / 选 menu / 滚 long output。
 *
 * 方案：在 xterm 容器上挂 touchstart/touchmove，识别垂直 swipe，按距离换算成
 * N 次"方向键序列"通过 onSendKey 发到 PTY：
 *   - 上滑（dy < 0）→ 发"下方向键" \x1b[B
 *   - 下滑（dy > 0）→ 发"上方向键" \x1b[A
 *
 * 关键设计：
 *   - 仅 alt-screen 时启用：普通 shell 让 xterm 走原生 scrollback
 *   - 垂直分量必须 > 水平分量 * 1.5：否则可能是横向选择 / 系统手势，放过
 *   - 起步阈值 8px：避免微抖动误触
 *   - 步长 28px / 1 个方向键：跟 vim/Termius 类似
 *   - rAF 合批：一帧最多发一波，避免瞬时连续 100 次按键
 *
 * 参考：Termius、Blink Shell、Tabby Web 的 touch-to-arrow 策略。
 */

import { useEffect, useRef, type RefObject } from 'react';

const STEP_PX = 28;
const MIN_DELTA_PX = 8;
/** 垂直 vs 水平分量的最小比例：dy > dx * 这个值 才算"垂直 swipe" */
const VERTICAL_RATIO = 1.5;

export interface UseTouchSwipeScrollOptions {
  /** 容器 ref（xterm 的挂载点） */
  containerRef: RefObject<HTMLElement | null>;
  /** 当前是否在 alt-screen；false 时此 hook 不接管，让 xterm 走原生滚动 */
  altScreen: boolean;
  /** 发送原始键序列到 PTY；调用者通常包装为 send({type:'user_input',data}) */
  onSendKey: (data: string) => void;
  /** 主开关：用户在设置里关掉这功能时传 false */
  enabled?: boolean;
}

export function useTouchSwipeScroll(opts: UseTouchSwipeScrollOptions): void {
  const { containerRef, altScreen, onSendKey, enabled = true } = opts;

  // 用 ref 装可变状态，避免每次 effect 重挂 listener
  const altRef = useRef(altScreen);
  const onSendKeyRef = useRef(onSendKey);
  altRef.current = altScreen;
  onSendKeyRef.current = onSendKey;

  useEffect(() => {
    if (!enabled) return;
    const el = containerRef.current;
    if (!el) return;

    /** 当前 swipe 起点 + 上次发送时的 Y（增量基线） */
    let startX = 0;
    let startY = 0;
    let lastEmitY = 0;
    let active = false;
    /** 是否判定为"垂直 swipe，要接管"。一旦接管就持续接管直到 touchend */
    let vertical = false;
    let rafId = 0;
    /** 累计未消化的距离（rAF 合批用） */
    let pendingDelta = 0;

    const emit = (): void => {
      rafId = 0;
      const steps = Math.trunc(pendingDelta / STEP_PX);
      if (steps === 0) return;
      // 消耗已发送的部分；保留余数，下次手指继续动累加上来
      pendingDelta -= steps * STEP_PX;
      // dy > 0 = 手指下滑 = 看上面内容 = 上方向键 (\x1b[A)
      // dy < 0 = 手指上滑 = 看下面内容 = 下方向键 (\x1b[B)
      const seq = steps > 0 ? '\x1b[A' : '\x1b[B';
      const count = Math.abs(steps);
      let payload = '';
      for (let i = 0; i < count; i++) payload += seq;
      onSendKeyRef.current(payload);
    };

    const onTouchStart = (e: TouchEvent): void => {
      // 仅 alt-screen 才接管；普通 shell 让 xterm 自己处理
      if (!altRef.current) return;
      // 多指（pinch / 缩放）不管
      if (e.touches.length !== 1) return;
      const t = e.touches[0];
      if (!t) return;
      startX = t.clientX;
      startY = t.clientY;
      lastEmitY = startY;
      active = true;
      vertical = false;
      pendingDelta = 0;
    };

    const onTouchMove = (e: TouchEvent): void => {
      if (!active || !altRef.current) return;
      const t = e.touches[0];
      if (!t) return;

      const dx = t.clientX - startX;
      const dy = t.clientY - startY;
      const adx = Math.abs(dx);
      const ady = Math.abs(dy);

      // 还没判定方向：等到位移够大再决定
      if (!vertical) {
        if (ady < MIN_DELTA_PX && adx < MIN_DELTA_PX) return;
        if (ady > adx * VERTICAL_RATIO) {
          vertical = true;
        } else {
          // 横向手势，整轮放弃接管
          active = false;
          return;
        }
      }

      // 阻止页面滚动（否则 alt-screen 内容会跟系统滚动冲突）
      // 仅在确认是垂直 swipe 后才阻止；横向放过让用户选文本
      if (e.cancelable) e.preventDefault();

      const deltaThisMove = t.clientY - lastEmitY;
      lastEmitY = t.clientY;
      pendingDelta += deltaThisMove;

      // rAF 合批：每帧最多发一次（拖到 60fps 内合理上限）
      if (rafId === 0) {
        rafId = window.requestAnimationFrame(emit);
      }
    };

    const onTouchEnd = (): void => {
      active = false;
      vertical = false;
      pendingDelta = 0;
      if (rafId !== 0) {
        cancelAnimationFrame(rafId);
        rafId = 0;
      }
    };

    // passive: false 才能 preventDefault
    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd, { passive: true });
    el.addEventListener('touchcancel', onTouchEnd, { passive: true });

    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('touchcancel', onTouchEnd);
      if (rafId !== 0) cancelAnimationFrame(rafId);
    };
  }, [containerRef, enabled]);
}
