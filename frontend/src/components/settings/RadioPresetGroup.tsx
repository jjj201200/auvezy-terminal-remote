/**
 * RadioPresetGroup<T> — 多选一预设按钮组。
 *
 * 抽自 ControlsSection 内重复 3 次的 section + radio 模式(scrollLines /
 * wheelSensitivity / 未来的其它枚举型偏好)。每项渲染:
 *   - section header(title + hint)
 *   - role="radiogroup" 行
 *   - 每个 preset 一个按钮(active 高亮 + aria-checked + disabled 状态)
 *
 * Why 不复用 BoolToggleRow:那是固定两按钮的二态开关,样式 + 语义更简单;
 * 此组件支持 N 个 preset + 通用 getLabel/getKey,可服务任意 enum/literal 类型。
 *
 * disabled 时:整组半透明 + pointer-events:none + 每个按钮 disabled。
 */

import type { JSX } from 'react';
import clsx from 'clsx';
import s from './GeneralSettings.module.scss';

export interface RadioPresetGroupProps<T> {
  title: string;
  hint?: string;
  /** aria-label,默认用 title */
  ariaLabel?: string;
  presets: readonly T[];
  value: T;
  /** 按钮文案。同一 preset 在 list 多次出现会按 getKey 作 key */
  getLabel: (preset: T) => string;
  /** 唯一 key;默认 String(preset),适用绝大多数 scalar/枚举 */
  getKey?: (preset: T) => string;
  onChange: (preset: T) => void;
  disabled?: boolean;
}

export function RadioPresetGroup<T>({
  title,
  hint,
  ariaLabel,
  presets,
  value,
  getLabel,
  getKey = (p) => String(p),
  onChange,
  disabled = false,
}: RadioPresetGroupProps<T>): JSX.Element {
  return (
    <section className={s.section} aria-disabled={disabled}>
      <header className={s.header}>
        <h3 className={s.title}>{title}</h3>
        {hint && <p className={s.hint}>{hint}</p>}
      </header>
      <div
        className={s.row}
        role="radiogroup"
        aria-label={ariaLabel ?? title}
        style={disabled ? { opacity: 0.5, pointerEvents: 'none' } : undefined}
      >
        {presets.map((preset) => {
          const active = preset === value;
          return (
            <button
              key={getKey(preset)}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={disabled}
              onClick={() => onChange(preset)}
              className={clsx(s.btn, active && s.btnActive)}
            >
              {getLabel(preset)}
            </button>
          );
        })}
      </div>
    </section>
  );
}
