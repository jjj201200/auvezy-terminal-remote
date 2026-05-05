/**
 * IconButton
 *
 * 图标按钮：lucide 图标 + 触控目标 ≥40×40（移动端）/ 26×26（桌面）。
 * 默认 ghost 风格（透明底、hover 时背景 elev 高亮）。
 */

import { type ButtonHTMLAttributes, type JSX, type ReactNode } from 'react';
import clsx from 'clsx';
import s from './IconButton.module.scss';

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
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
      className={clsx(s.root, variant === 'accent' && s.variantAccent, className)}
    >
      {children}
    </button>
  );
}
