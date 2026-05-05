/**
 * TextField
 *
 * 受控 input + 错误态边框 + helper text。
 * 不带 label（label 由调用者控制布局）。
 */

import { forwardRef, type InputHTMLAttributes } from 'react';
import clsx from 'clsx';
import s from './TextField.module.scss';

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
    <div className={s.wrap}>
      <input
        ref={ref}
        {...rest}
        className={clsx(s.input, mono && s.mono, error && s.errored, className)}
      />
      {error && <span className={s.error}>{error}</span>}
      {!error && helper && <span className={s.helper}>{helper}</span>}
    </div>
  );
});
