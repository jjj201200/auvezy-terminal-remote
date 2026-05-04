/**
 * ScrollToBottomButton
 *
 * 当用户向上滚动离开底部时显示的悬浮按钮，点击回到底部并恢复 auto-follow。
 */

import type { JSX } from 'react';

export interface ScrollToBottomButtonProps {
  visible: boolean;
  onClick: () => void;
}

export function ScrollToBottomButton({ visible, onClick }: ScrollToBottomButtonProps): JSX.Element | null {
  if (!visible) return null;
  return (
    <button
      type="button"
      onClick={onClick}
      className="scroll-to-bottom-btn"
      aria-label="返回底部"
      title="返回底部"
    >
      ↓
    </button>
  );
}
