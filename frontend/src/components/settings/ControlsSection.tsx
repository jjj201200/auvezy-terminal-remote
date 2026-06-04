/**
 * ControlsSection
 *
 * "操作 / 一般设置" section 的内容：
 *  - 输入方式（底部输入框 / 直接输入）
 *  - TUI 滚动接管开关（默认关闭）
 *  - 每次滚动行数（开关启用后才有意义；关闭时仍可见但灰显）
 *
 * 三项都属于"运行时操作行为"，因此从原 GeneralSettings 拆出，挪到"操作"tab。
 */

import type { JSX } from 'react';
import clsx from 'clsx';
import {
  type UserConfig,
  type ScrollLinesValue,
  type WheelSensitivity,
  SCROLL_LINES_PRESETS,
  WHEEL_SENSITIVITY_PRESETS,
  DEFAULT_INPUT,
} from 'auvezy-terminal-remote-shared';
import { useT } from '../../i18n/i18n-context.js';
import { RadioPresetGroup } from './RadioPresetGroup.js';
import s from './GeneralSettings.module.scss';

export interface ControlsSectionProps {
  value: UserConfig;
  onChange: (next: UserConfig) => void;
}

export function ControlsSection({ value, onChange }: ControlsSectionProps): JSX.Element {
  const t = useT();
  const useInputBar = value.input?.useInputBar !== false;
  // 默认开启：缺省字段 / true 都算开；显式 false 才算关
  const tuiScrollEnabled = value.input?.tuiScrollEnabled !== false;
  const tuiTapEnabled = value.input?.tuiTapEnabled !== false;
  const scrollLines: ScrollLinesValue =
    value.input?.scrollLines ?? DEFAULT_INPUT.scrollLines;
  const wheelSensitivity: WheelSensitivity =
    value.input?.wheelSensitivity ?? DEFAULT_INPUT.wheelSensitivity;

  const setInput = (patch: Partial<NonNullable<UserConfig['input']>>): void => {
    onChange({
      ...value,
      input: { ...(value.input ?? {}), ...patch },
    });
  };

  const presetLabel = (p: ScrollLinesValue): string => {
    if (p === 'half') return t('actions.scrollLinesHalf');
    if (p === 'full') return t('actions.scrollLinesFull');
    return `${p} ${t('actions.scrollLinesUnitLine')}`;
  };

  const wsLabel = (w: WheelSensitivity): string => {
    if (w === 'low') return t('actions.wheelSensitivityLow');
    if (w === 'high') return t('actions.wheelSensitivityHigh');
    return t('actions.wheelSensitivityMed');
  };

  return (
    <>
      <section className={s.section}>
        <header className={s.header}>
          <h3 className={s.title}>{t('actions.inputModeTitle')}</h3>
          <p className={s.hint}>{t('actions.inputModeHint')}</p>
        </header>
        <div className={s.row} role="radiogroup" aria-label={t('actions.inputModeTitle')}>
          <button
            type="button"
            role="radio"
            aria-checked={useInputBar}
            onClick={() => setInput({ useInputBar: true })}
            className={clsx(s.btn, useInputBar && s.btnActive)}
          >
            {t('actions.inputModeUseBar')}
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={!useInputBar}
            onClick={() => setInput({ useInputBar: false })}
            className={clsx(s.btn, !useInputBar && s.btnActive)}
          >
            {t('actions.inputModeDirect')}
          </button>
        </div>
      </section>

      <section className={s.section}>
        <header className={s.header}>
          <h3 className={s.title}>{t('actions.tuiScrollTitle')}</h3>
          <p className={s.hint}>{t('actions.tuiScrollHint')}</p>
        </header>
        <div className={s.row} role="radiogroup" aria-label={t('actions.tuiScrollTitle')}>
          <button
            type="button"
            role="radio"
            aria-checked={tuiScrollEnabled}
            onClick={() => setInput({ tuiScrollEnabled: true })}
            className={clsx(s.btn, tuiScrollEnabled && s.btnActive)}
          >
            {t('actions.tuiScrollOn')}
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={!tuiScrollEnabled}
            onClick={() => setInput({ tuiScrollEnabled: false })}
            className={clsx(s.btn, !tuiScrollEnabled && s.btnActive)}
          >
            {t('actions.tuiScrollOff')}
          </button>
        </div>
      </section>

      <section className={s.section}>
        <header className={s.header}>
          <h3 className={s.title}>{t('actions.tuiTapTitle')}</h3>
          <p className={s.hint}>{t('actions.tuiTapHint')}</p>
        </header>
        <div className={s.row} role="radiogroup" aria-label={t('actions.tuiTapTitle')}>
          <button
            type="button"
            role="radio"
            aria-checked={tuiTapEnabled}
            onClick={() => setInput({ tuiTapEnabled: true })}
            className={clsx(s.btn, tuiTapEnabled && s.btnActive)}
          >
            {t('actions.tuiTapOn')}
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={!tuiTapEnabled}
            onClick={() => setInput({ tuiTapEnabled: false })}
            className={clsx(s.btn, !tuiTapEnabled && s.btnActive)}
          >
            {t('actions.tuiTapOff')}
          </button>
        </div>
      </section>

      <RadioPresetGroup
        title={t('actions.scrollLinesTitle')}
        hint={t('actions.scrollLinesHint')}
        presets={SCROLL_LINES_PRESETS}
        value={scrollLines}
        getLabel={presetLabel}
        onChange={(p) => setInput({ scrollLines: p })}
        disabled={!tuiScrollEnabled}
      />

      <RadioPresetGroup
        title={t('actions.wheelSensitivityTitle')}
        hint={t('actions.wheelSensitivityHint')}
        presets={WHEEL_SENSITIVITY_PRESETS}
        value={wheelSensitivity}
        getLabel={wsLabel}
        onChange={(p) => setInput({ wheelSensitivity: p })}
        disabled={!tuiScrollEnabled}
      />
    </>
  );
}
