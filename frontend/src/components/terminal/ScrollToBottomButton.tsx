/**
 * ScrollToBottomButton
 *
 * 用户向上滚动离开底部时显示的悬浮按钮。
 * 键盘弹起时通过 .hide-on-keyboard 隐藏（避免被键盘遮）。
 */

import type { JSX } from 'react';
import { ArrowDown } from 'lucide-react';

export interface ScrollToBottomButtonProps {
  visible: boolean;
  onClick: () => void;
}

export function ScrollToBottomButton({
  visible,
  onClick,
}: ScrollToBottomButtonProps): JSX.Element | null {
  if (!visible) return null;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="返回底部"
      title="返回底部"
      className="hide-on-keyboard absolute right-4 bottom-4 z-10 flex h-11 w-11 items-center justify-center rounded-full bg-[var(--color-accent)] text-white shadow-lg hover:opacity-90"
    >
      <ArrowDown size={18} strokeWidth={1.5} />
    </button>
  );
}
