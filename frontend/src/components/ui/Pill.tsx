/**
 * Pill
 *
 * 状态徽标：圆角 99px、等宽字体、单色边框；支持多 tone。
 * 用于 StatusBar、实例 tab 内端口号等。
 */

import { type JSX, type ReactNode } from 'react';
import { cn } from '../../utils/cn.js';

export type PillTone = 'ok' | 'warn' | 'error' | 'muted' | 'accent';

export interface PillProps {
  tone?: PillTone;
  children: ReactNode;
  className?: string;
}

const TONE_CLASS: Record<PillTone, string> = {
  ok: 'border-[var(--color-success)] text-[var(--color-success)]',
  warn: 'border-[var(--color-warning)] text-[var(--color-warning)]',
  error: 'border-[var(--color-error)] text-[var(--color-error)]',
  muted: 'border-[var(--color-border)] text-[var(--color-fg-muted)]',
  accent: 'border-[var(--color-accent)] text-[var(--color-accent)]',
};

export function Pill({ tone = 'muted', children, className }: PillProps): JSX.Element {
  return (
    <span
      className={cn(
        'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-mono whitespace-nowrap',
        TONE_CLASS[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
