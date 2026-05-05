/**
 * TextField
 *
 * 受控 input + 错误态边框 + helper text。
 * 不带 label（label 由调用者控制布局）。
 */

import { forwardRef, type InputHTMLAttributes } from 'react';
import { cn } from '../../utils/cn.js';

export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  /** 错误信息（非空时切红边） */
  error?: string | null;
  /** 提示文字 */
  helper?: string;
  /** 字体走 mono 还是 sans */
  mono?: boolean;
}

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { error, helper, mono, className, ...rest },
  ref,
) {
  return (
    <div className="flex flex-col gap-1 min-w-0 flex-1">
      <input
        ref={ref}
        {...rest}
        className={cn(
          'rounded-md border bg-[var(--color-bg)] px-2 py-1.5 text-[var(--color-fg)] outline-none',
          'text-sm',
          mono ? 'font-mono' : 'font-sans',
          error
            ? 'border-[var(--color-error)] focus:border-[var(--color-error)]'
            : 'border-[var(--color-border)] focus:border-[var(--color-accent)]',
          'disabled:opacity-50',
          className,
        )}
      />
      {error && <span className="text-xs text-[var(--color-error)] font-sans">{error}</span>}
      {!error && helper && (
        <span className="text-xs text-[var(--color-fg-muted)] font-sans">{helper}</span>
      )}
    </div>
  );
});
