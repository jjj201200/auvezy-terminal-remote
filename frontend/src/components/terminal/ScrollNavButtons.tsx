/**
 * ScrollNavButtons
 *
 * 终端右下角的"回到底部"小方按钮（半透明，hover 时不透明）。
 *
 * 仅在用户向上滚动离开底部时才显示（visible=true）。
 * 键盘弹起时通过 .hide-on-keyboard 隐藏（避免被键盘遮）。
 */

import type { JSX } from 'react';
import { IconArrowBarToDown } from '@tabler/icons-react';
import clsx from 'clsx';
import { useT } from '../../i18n/i18n-context.js';
import s from './ScrollNavButtons.module.scss';

export interface ScrollNavButtonsProps {
  visible: boolean;
  onScrollToBottom: () => void;
}

export function ScrollNavButtons({
  visible,
  onScrollToBottom,
}: ScrollNavButtonsProps): JSX.Element | null {
  const t = useT();
  if (!visible) return null;
  return (
    <div className={clsx(s.root, 'hide-on-keyboard')}>
      <button
        type="button"
        onClick={onScrollToBottom}
        aria-label={t('scrollToBottom.label')}
        title={t('scrollToBottom.label')}
        className={s.btn}
      >
        <IconArrowBarToDown size={14} stroke={1.5} />
      </button>
    </div>
  );
}
