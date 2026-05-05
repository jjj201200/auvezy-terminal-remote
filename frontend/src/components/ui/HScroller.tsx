/**
 * HScroller
 *
 * 通用「水平滚动 + 端点箭头 + 拖拽」容器。三处复用：
 *  1. ScrollableTabs（分类 tab 行）
 *  2. Toolbar 下方按钮区（快捷键 / 命令按钮）
 *  3. SettingsModal header 的 tab 行（通过 ScrollableTabs 间接复用）
 *
 * 行为：
 *  - 内容溢出时，左右两侧浮出箭头按钮（一旦曾溢出就一直占位，端点处淡出 + disabled，避免抖动）
 *  - 支持 pointer 拖拽（鼠标按住或触摸滑动），位移阈值 4px，超过才视为拖拽
 *  - 拖拽收尾会吞掉随之到达的 click（避免被误识别为按钮点击）
 *  - direction='rtl' → 用 `row-reverse` 视觉镜像，但物理 scrollLeft 仍为正
 *
 * API 设计取舍：
 *  - 不限定 children 形态：tab 行 / 按钮列表 / 任意横排 React 节点都可
 *  - 提供 ref 读 scroller DOM，让 caller 在需要时调 scrollIntoView 自己实现的元素
 *    （比如 ScrollableTabs 在 active 变化时把当前 tab 滚到可见）
 *  - "click 是不是拖拽收尾" 的判断暴露为 isClickFromDrag()，caller 自己决定吞不吞 click
 */

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type JSX,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { IconChevronLeft, IconChevronRight } from '@tabler/icons-react';
import clsx from 'clsx';
import { useT } from '../../i18n/i18n-context.js';
import s from './HScroller.module.scss';

/** 拖拽阈值：超过这个像素位移就视为拖拽，不触发 click */
const DRAG_THRESHOLD = 4;

export interface HScrollerProps {
  children: ReactNode;
  /** 视觉方向：rtl 时 children 用 row-reverse 镜像排布 */
  direction?: 'ltr' | 'rtl';
  /** 全局禁用（如未连接），影响 cursor / 子元素自行处理 disabled */
  disabled?: boolean;
  /** 容器外类名 */
  className?: string;
  /** 内部 .scroller 类名（让 caller 控制 gap / padding） */
  scrollerClassName?: string;
  /** 监听 children 变化重算溢出（caller 把识别 key 传进来） */
  refreshKey?: unknown;
  /** 内部 .scroller 的 inline style（个别场景需要） */
  scrollerStyle?: CSSProperties;
}

export interface HScrollerHandle {
  /** 拿到 .scroller DOM 元素，caller 可调用 scrollIntoView 等 */
  getScroller: () => HTMLDivElement | null;
  /** 当前 click 是不是拖拽收尾导致的（在 onClick 里调用，true 时应 return 不响应） */
  isClickFromDrag: () => boolean;
}

export const HScroller = forwardRef<HScrollerHandle, HScrollerProps>(function HScroller(
  { children, direction = 'ltr', disabled, className, scrollerClassName, refreshKey, scrollerStyle },
  ref,
) {
  const t = useT();
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [overflowLeft, setOverflowLeft] = useState(false);
  const [overflowRight, setOverflowRight] = useState(false);
  // 一旦曾经溢出就保持显示两个箭头（端点处仅 disabled，避免内容宽度抖动）
  const [hasOverflow, setHasOverflow] = useState(false);

  // 拖拽状态
  const dragState = useRef<{
    pointerId: number;
    startX: number;
    startScroll: number;
    moved: boolean;
    captured: boolean;
  } | null>(null);
  const justDraggedRef = useRef(false);

  /** 检查溢出 + 当前滚动位置，更新左右箭头 */
  const updateOverflow = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const { scrollLeft, scrollWidth, clientWidth } = el;
    const max = scrollWidth - clientWidth;
    setOverflowLeft(scrollLeft > 0.5);
    setOverflowRight(scrollLeft < max - 0.5);
    if (max > 0.5) setHasOverflow(true);
  }, []);

  // 初次挂载 + refreshKey 变化（如 children 列表变化）时重算
  useLayoutEffect(() => {
    setHasOverflow(false);
    updateOverflow();
  }, [refreshKey, updateOverflow]);

  // 监听容器尺寸变化
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ob = new ResizeObserver(() => updateOverflow());
    ob.observe(el);
    return () => ob.disconnect();
  }, [updateOverflow]);

  const onScroll = useCallback(() => {
    updateOverflow();
  }, [updateOverflow]);

  const scrollByDir = useCallback((dir: 1 | -1) => {
    const el = scrollerRef.current;
    if (!el) return;
    const step = Math.max(120, Math.floor(el.clientWidth * 0.6));
    el.scrollBy({ left: dir * step, behavior: 'smooth' });
  }, []);

  // ──────────────── 拖拽 ────────────────

  const onPointerDown = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    const el = scrollerRef.current;
    if (!el) return;
    dragState.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startScroll: el.scrollLeft,
      moved: false,
      captured: false,
    };
  }, []);

  const onPointerMove = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const st = dragState.current;
    if (!st || st.pointerId !== e.pointerId) return;
    const el = scrollerRef.current;
    if (!el) return;
    const dx = e.clientX - st.startX;
    if (!st.moved && Math.abs(dx) > DRAG_THRESHOLD) {
      st.moved = true;
      try {
        el.setPointerCapture(e.pointerId);
        st.captured = true;
      } catch {
        /* 已释放或不可用：忽略 */
      }
    }
    if (st.moved) {
      el.scrollLeft = st.startScroll - dx;
      e.preventDefault();
    }
  }, []);

  const endDrag = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const st = dragState.current;
    if (!st || st.pointerId !== e.pointerId) return;
    const el = scrollerRef.current;
    if (el && st.captured && el.hasPointerCapture(e.pointerId)) {
      el.releasePointerCapture(e.pointerId);
    }
    if (st.moved) {
      justDraggedRef.current = true;
      setTimeout(() => {
        justDraggedRef.current = false;
      }, 0);
    }
    dragState.current = null;
  }, []);

  // 暴露给 caller 的 imperative API
  useImperativeHandle(
    ref,
    () => ({
      getScroller: () => scrollerRef.current,
      isClickFromDrag: () => justDraggedRef.current,
    }),
    [],
  );

  const leftDisabled = !overflowLeft;
  const rightDisabled = !overflowRight;

  return (
    <div className={clsx(s.wrap, className)}>
      <button
        type="button"
        aria-label={t('input.scrollLeft')}
        // 阻止按钮默认聚焦：保留 InputBar 焦点，避免移动端键盘收起
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => scrollByDir(-1)}
        disabled={leftDisabled || disabled}
        className={clsx(
          s.arrow,
          s.arrowLeft,
          !hasOverflow && s.arrowGone,
          leftDisabled && hasOverflow && s.arrowDisabled,
        )}
        tabIndex={!hasOverflow || leftDisabled ? -1 : 0}
        aria-hidden={!hasOverflow}
      >
        <IconChevronLeft size={12} stroke={1.5} />
      </button>
      <div
        ref={scrollerRef}
        className={clsx(
          s.scroller,
          direction === 'rtl' && s.scrollerRtl,
          scrollerClassName,
        )}
        style={scrollerStyle}
        onScroll={onScroll}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        {children}
      </div>
      <button
        type="button"
        aria-label={t('input.scrollRight')}
        // 阻止按钮默认聚焦：保留 InputBar 焦点，避免移动端键盘收起
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => scrollByDir(1)}
        disabled={rightDisabled || disabled}
        className={clsx(
          s.arrow,
          s.arrowRight,
          !hasOverflow && s.arrowGone,
          rightDisabled && hasOverflow && s.arrowDisabled,
        )}
        tabIndex={!hasOverflow || rightDisabled ? -1 : 0}
        aria-hidden={!hasOverflow}
      >
        <IconChevronRight size={12} stroke={1.5} />
      </button>
    </div>
  );
});
