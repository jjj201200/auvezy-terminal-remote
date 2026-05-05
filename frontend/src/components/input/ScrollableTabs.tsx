/**
 * ScrollableTabs
 *
 * 横向可滚动的 tab 行。供「快捷键分类」「命令分类」复用。
 *
 * 行为：
 *  - direction='ltr'：从左往右排列（用于快捷键分类）
 *  - direction='rtl'：从右往左排列（用于命令分类）
 *      —— 通过 `flex-direction: row-reverse` 实现，DOM 顺序仍为 items 顺序
 *  - 当内容溢出容器宽度时，左右两侧浮出箭头按钮（与方向无关，始终是物理上的左右）
 *  - 支持鼠标拖拽（按住任意空白或按钮拖动）和触摸滑动浏览
 *  - 点击 tab：触发 onChange；拖拽与点击通过位移阈值区分（>4px 视为拖拽，不触发点击）
 *
 * 设计取舍：
 *  - 不用第三方滚动库；scrollLeft 自己管，因为 native overflow:auto + 阻尼足够好
 *  - 拖拽用 pointer events（一套 API 同时支持鼠标 / 触摸 / 触控笔）
 *  - 箭头点击滚动半个可视宽度，足够覆盖移动端单手操作
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type JSX,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { IconChevronLeft, IconChevronRight } from '@tabler/icons-react';
import clsx from 'clsx';
import s from './ScrollableTabs.module.scss';

export interface ScrollableTabItem {
  id: string;
  title: string;
}

export interface ScrollableTabsProps {
  /** tab 列表 */
  items: ScrollableTabItem[];
  /** 当前激活 id；为 null 表示无激活 */
  activeId: string | null;
  /** 选中变更 */
  onChange: (id: string) => void;
  /** 全局禁用（如未连接） */
  disabled?: boolean;
  /** 排列方向：ltr=左到右；rtl=右到左 */
  direction?: 'ltr' | 'rtl';
  /** 额外类名（容器） */
  className?: string;
  /** 激活态附加类名（如 phosphor-glow） */
  activeClassName?: string;
}

/** 拖拽阈值：超过这个像素位移就视为拖拽，不触发 click */
const DRAG_THRESHOLD = 4;

export function ScrollableTabs({
  items,
  activeId,
  onChange,
  disabled,
  direction = 'ltr',
  className,
  activeClassName,
}: ScrollableTabsProps): JSX.Element {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [overflowLeft, setOverflowLeft] = useState(false);
  const [overflowRight, setOverflowRight] = useState(false);

  // 拖拽状态
  // 关键：moved 在 pointerdown 时仅记录起点，超过 DRAG_THRESHOLD 才正式 capture pointer。
  // 不在 pointerdown 立即 capture：避免普通点击被 capture 影响 click 事件派发到 button。
  // dragEnded 用 ref 记录"刚结束的拖拽"，让随后到达的 click 能识别并阻止。
  const dragState = useRef<{
    pointerId: number;
    startX: number;
    startScroll: number;
    moved: boolean;
    captured: boolean;
  } | null>(null);
  // 标记最近一次 pointerup 是不是从拖拽中收尾的；下一个 click 看到这个会 noop
  const justDraggedRef = useRef(false);

  /** 检查溢出 + 当前滚动位置，更新左右箭头 */
  const updateOverflow = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    // 注意：rtl 方向下 scrollLeft 在不同浏览器里行为可能不一致，
    // 但我们用 row-reverse 而不是 dir="rtl"，scrollLeft 仍是正常的「物理左侧已滚动距离」。
    const { scrollLeft, scrollWidth, clientWidth } = el;
    const max = scrollWidth - clientWidth;
    setOverflowLeft(scrollLeft > 0.5);
    setOverflowRight(scrollLeft < max - 0.5);
  }, []);

  // 初次挂载 + items 变化时计算
  useLayoutEffect(() => {
    updateOverflow();
  }, [items, updateOverflow]);

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
    // 仅主指针 / 主键
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
    // 不在此处 setPointerCapture：先观望是否真的拖拽，避免普通点击被 capture 干扰 click
  }, []);

  const onPointerMove = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const st = dragState.current;
    if (!st || st.pointerId !== e.pointerId) return;
    const el = scrollerRef.current;
    if (!el) return;
    const dx = e.clientX - st.startX;
    if (!st.moved && Math.abs(dx) > DRAG_THRESHOLD) {
      st.moved = true;
      // 仅在真正开始拖拽时才 capture：保证拖出按钮区也能持续滚动
      try {
        el.setPointerCapture(e.pointerId);
        st.captured = true;
      } catch {
        // 已被释放或 pointerId 不可用：忽略，不影响后续 scrollLeft 写入
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
      // 让随后立刻派发的 click 知道这其实是拖拽收尾，不应该当成选中
      justDraggedRef.current = true;
      // 一拍后清除，避免影响后续真正的 click
      setTimeout(() => {
        justDraggedRef.current = false;
      }, 0);
    }
    dragState.current = null;
  }, []);

  /** 点击 tab —— 拖拽收尾的 click 会被吞 */
  const handleTabClick = useCallback(
    (id: string) => {
      if (justDraggedRef.current) return;
      onChange(id);
    },
    [onChange],
  );

  // 当激活项变化时尝试滚动到可见
  useEffect(() => {
    if (activeId === null) return;
    const el = scrollerRef.current;
    if (!el) return;
    const target = el.querySelector<HTMLElement>(`[data-tab-id="${CSS.escape(activeId)}"]`);
    if (!target) return;
    const elRect = el.getBoundingClientRect();
    const tRect = target.getBoundingClientRect();
    if (tRect.left < elRect.left || tRect.right > elRect.right) {
      target.scrollIntoView({ behavior: 'smooth', inline: 'nearest', block: 'nearest' });
    }
  }, [activeId]);

  return (
    <div className={clsx(s.wrap, className)}>
      <button
        type="button"
        aria-label="向左滚动"
        onClick={() => scrollByDir(-1)}
        className={clsx(s.arrow, s.arrowLeft, !overflowLeft && s.arrowHidden)}
        tabIndex={overflowLeft ? 0 : -1}
      >
        <IconChevronLeft size={12} stroke={1.5} />
      </button>
      <div
        ref={scrollerRef}
        className={clsx(s.scroller, direction === 'rtl' && s.scrollerRtl)}
        onScroll={onScroll}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        {items.map((it) => (
          <button
            key={it.id}
            type="button"
            data-tab-id={it.id}
            disabled={disabled}
            onClick={() => handleTabClick(it.id)}
            className={clsx(
              s.tab,
              activeId === it.id && s.tabActive,
              activeId === it.id && activeClassName,
            )}
          >
            {it.title}
          </button>
        ))}
      </div>
      <button
        type="button"
        aria-label="向右滚动"
        onClick={() => scrollByDir(1)}
        className={clsx(s.arrow, s.arrowRight, !overflowRight && s.arrowHidden)}
        tabIndex={overflowRight ? 0 : -1}
      >
        <IconChevronRight size={12} stroke={1.5} />
      </button>
    </div>
  );
}
