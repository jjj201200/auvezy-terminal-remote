/**
 * BoolToggleRow
 *
 * 设置面板里通用的"开 / 关"双按钮组件:
 *  - 标题 + hint(说明) 在上方
 *  - 下方一行两个按钮(开 / 关),与"操作"tab 的 TUI 滚动接管开关 UI 完全一致
 *  - 可选 note 行(info 蓝 / warn 琥珀 / 默认无),用于补充隐私/警告等彩色提示
 *
 * 抽出来是为了让 IntegrationsSettings / DevSettings 等 boolean 设置项保持
 * 视觉一致;number / 多选保持各自专用控件不动。
 */

import type { JSX, ReactNode } from 'react';
import clsx from 'clsx';
import { useT } from '../../i18n/i18n-context.js';
import s from './GeneralSettings.module.scss';

export interface BoolToggleRowProps {
  /** 标题(必填) */
  title: string;
  /** 灰色 hint 行;未填则不显示 hint */
  hint?: ReactNode;
  /** 当前布尔值 */
  value: boolean;
  /** 切换回调 */
  onChange: (next: boolean) => void;
  /** 整组 disable(灰显 + 不响应) */
  disabled?: boolean;
  /** 开按钮文案;不传走 i18n common.on */
  onLabel?: string;
  /** 关按钮文案;不传走 i18n common.off */
  offLabel?: string;
  /** 可选补充提示;tone='info' 蓝色 / tone='warn' 琥珀色 */
  note?: { tone: 'info' | 'warn'; text: ReactNode };
}

export function BoolToggleRow({
  title,
  hint,
  value,
  onChange,
  disabled,
  onLabel,
  offLabel,
  note,
}: BoolToggleRowProps): JSX.Element {
  const t = useT();
  // common.on / common.off 不存在时退回硬编码,与"操作"tab 的 tuiScrollOn/Off 风格一致
  const onText = onLabel ?? t('common.on');
  const offText = offLabel ?? t('common.off');

  return (
    <section
      className={s.section}
      aria-disabled={disabled || undefined}
    >
      <header className={s.header}>
        <h3 className={s.title}>{title}</h3>
        {hint !== undefined && hint !== null && hint !== '' && <p className={s.hint}>{hint}</p>}
      </header>
      <div
        className={s.row}
        role="radiogroup"
        aria-label={title}
        style={disabled ? { opacity: 0.5, pointerEvents: 'none' } : undefined}
      >
        <button
          type="button"
          role="radio"
          aria-checked={value}
          disabled={disabled}
          onClick={() => onChange(true)}
          className={clsx(s.btn, value && s.btnActive)}
        >
          {onText}
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={!value}
          disabled={disabled}
          onClick={() => onChange(false)}
          className={clsx(s.btn, !value && s.btnActive)}
        >
          {offText}
        </button>
      </div>
      {note && (
        <p className={clsx(s.note, note.tone === 'warn' ? s.noteWarn : s.noteInfo)}>
          {note.text}
        </p>
      )}
    </section>
  );
}
