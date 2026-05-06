/**
 * TextField
 *
 * 受控 input + 错误态边框 + helper text + 可选的清空按钮。
 * 不带 label（label 由调用者控制布局）。
 */

import { forwardRef, type InputHTMLAttributes } from 'react';
import { IconX } from '@tabler/icons-react';
import clsx from 'clsx';
import { useT } from '../../i18n/i18n-context.js';
import s from './TextField.module.scss';

export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  /** 错误信息（非空时切红边） */
  error?: string | null;
  /** 提示文字 */
  helper?: string;
  /** 字体走 mono 还是 sans */
  mono?: boolean;
  /**
   * 提供 onClear 后，input 右侧渲染 × 按钮（仅当 value 非空时显示）。
   * 点击触发 onClear；TextField 不修改 value（受控组件，由调用方负责）。
   */
  onClear?: () => void;
}

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { error, helper, mono, className, onClear, value, ...rest },
  ref,
) {
  const t = useT();
  const showClear =
    onClear &&
    !rest.disabled &&
    typeof value === 'string' &&
    value.length > 0;
  return (
    <div className={s.wrap}>
      <div className={s.inputWrap}>
        <input
          ref={ref}
          value={value}
          {...rest}
          className={clsx(
            s.input,
            mono && s.mono,
            error && s.errored,
            showClear && s.hasClear,
            className,
          )}
        />
        {showClear && (
          <button
            type="button"
            // mousedown 阻止默认，避免 input 失焦闪烁
            onMouseDown={(e) => e.preventDefault()}
            onClick={onClear}
            aria-label={t('common.clear')}
            title={t('common.clear')}
            className={s.clearBtn}
          >
            <IconX size={12} stroke={1.5} />
          </button>
        )}
      </div>
      {error && <span className={s.error}>{error}</span>}
      {!error && helper && <span className={s.helper}>{helper}</span>}
    </div>
  );
});
