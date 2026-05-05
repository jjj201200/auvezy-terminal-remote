/**
 * ScrollToBottomButton
 *
 * 用户向上滚动离开底部时显示的悬浮按钮。
 * 键盘弹起时通过 .hide-on-keyboard 隐藏（避免被键盘遮）。
 */

import type { JSX } from 'react';
import { IconArrowDown } from '@tabler/icons-react';
import clsx from 'clsx';
import s from './ScrollToBottomButton.module.scss';

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
      id="scroll-to-bottom-btn"
      type="button"
      onClick={onClick}
      aria-label="返回底部"
      title="返回底部"
      className={clsx(s.root, 'hide-on-keyboard')}
    >
      <IconArrowDown size={18} stroke={1.5} />
    </button>
  );
}
