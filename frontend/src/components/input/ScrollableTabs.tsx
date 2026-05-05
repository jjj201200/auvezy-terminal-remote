/**
 * ScrollableTabs
 *
 * 横向可滚动的 tab 行：HScroller + tab 选中语义。
 *
 * 自身职责：
 *  - 渲染 tab 按钮（active 高亮）
 *  - active 变化时把当前 tab 滚到可见
 *  - 拖拽收尾的 click 不当 tab 选中（通过 HScroller.isClickFromDrag()）
 *
 * 滚动机制（拖拽 / 箭头 / 端点 disabled / overflow 检测）已下沉到 HScroller。
 */

import { useCallback, useEffect, useRef, type JSX } from 'react';
import clsx from 'clsx';
import { HScroller, type HScrollerHandle } from '../ui/HScroller.js';
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

export function ScrollableTabs({
  items,
  activeId,
  onChange,
  disabled,
  direction = 'ltr',
  className,
  activeClassName,
}: ScrollableTabsProps): JSX.Element {
  const scrollerRef = useRef<HScrollerHandle | null>(null);

  /** 点击 tab —— 拖拽收尾的 click 会被吞 */
  const handleTabClick = useCallback(
    (id: string) => {
      if (scrollerRef.current?.isClickFromDrag()) return;
      onChange(id);
    },
    [onChange],
  );

  // 当激活项变化时尝试滚动到可见
  useEffect(() => {
    if (activeId === null) return;
    const el = scrollerRef.current?.getScroller();
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
    <HScroller
      ref={scrollerRef}
      direction={direction}
      disabled={disabled}
      className={className}
      scrollerClassName={s.tabsScroller}
      refreshKey={items}
    >
      {items.map((it) => (
        <button
          key={it.id}
          type="button"
          data-tab-id={it.id}
          disabled={disabled}
          // 阻止按钮默认聚焦：保留 InputBar 焦点，避免移动端键盘收起
          onMouseDown={(e) => e.preventDefault()}
          onPointerDown={(e) => {
            if (e.pointerType !== 'mouse') e.preventDefault();
          }}
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
    </HScroller>
  );
}
