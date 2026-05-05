/**
 * IconButton
 *
 * 图标按钮：lucide 图标 + 触控目标 ≥40×40（移动端）/ 28×28（桌面）。
 * 默认 ghost 风格（透明底、hover 时浮起边框）。
 */

import { type ButtonHTMLAttributes, type JSX, type ReactNode } from 'react';
import { cn } from '../../utils/cn.js';

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  /** 视觉变体 */
  variant?: 'ghost' | 'accent';
}

export function IconButton({
  children,
  variant = 'ghost',
  className,
  ...rest
}: IconButtonProps): JSX.Element {
  return (
    <button
      type="button"
      {...rest}
      className={cn(
        'inline-flex items-center justify-center rounded-md transition-colors',
        'min-h-[40px] min-w-[40px] md:min-h-[28px] md:min-w-[28px]',
        'p-2 md:p-1',
        variant === 'ghost' &&
          'text-[var(--color-fg-muted)] hover:bg-[var(--color-border)] hover:text-[var(--color-fg)]',
        variant === 'accent' && 'bg-[var(--color-accent)] text-white hover:opacity-90',
        rest.disabled && 'opacity-40 cursor-not-allowed',
        className,
      )}
    >
      {children}
    </button>
  );
}
