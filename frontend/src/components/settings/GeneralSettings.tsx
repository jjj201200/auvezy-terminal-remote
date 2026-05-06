/**
 * GeneralSettings
 *
 * 通用设置 tab：
 *  - 语言切换（即时生效，无需 Save）
 *  - 输入：使用底部输入框 vs 直接在终端区输入（实验性，会被 Save 持久化）
 */

import type { JSX } from 'react';
import type { UserConfig } from 'auvezy-terminal-remote-shared';
import { LanguageSwitch } from '../../i18n/LanguageSwitch.js';
import { Toggle } from '../ui/Toggle.js';
import { useT } from '../../i18n/i18n-context.js';
import s from './GeneralSettings.module.scss';

export interface GeneralSettingsProps {
  value: UserConfig;
  onChange: (next: UserConfig) => void;
}

export function GeneralSettings({ value, onChange }: GeneralSettingsProps): JSX.Element {
  const t = useT();
  const useInputBar = value.input?.useInputBar !== false;

  return (
    <div className={s.root}>
      <LanguageSwitch />

      <section className={s.section}>
        <header className={s.header}>
          <h3 className={s.title}>{t('general.inputModeTitle')}</h3>
          <p className={s.hint}>{t('general.inputModeHint')}</p>
        </header>
        <Toggle
          checked={useInputBar}
          onCheckedChange={(next) => {
            onChange({
              ...value,
              input: { ...(value.input ?? {}), useInputBar: next },
            });
          }}
          label={
            useInputBar
              ? t('general.inputModeUseBar')
              : t('general.inputModeDirect')
          }
        />
      </section>
    </div>
  );
}
