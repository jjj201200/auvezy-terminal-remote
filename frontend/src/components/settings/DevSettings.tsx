/**
 * DevSettings
 *
 * 开发者选项。仅本设备生效（client prefs，写 localStorage）。
 * 切换后需刷新页面才能生效（开关在 main.tsx 启动时被读取）。
 *
 * 受控：外部（SettingsModal）持有草稿，本组件只渲染并 onChange 上报。保存
 * 由 SettingsModal 的"保存"按钮统一触发，与其它 tab 一致。
 */

import type { JSX } from 'react';
import { Toggle } from '../ui/Toggle.js';
import { useT } from '../../i18n/i18n-context.js';
import type { ClientPrefs } from '../../services/client-prefs.js';
import s from './GeneralSettings.module.scss';

export interface DevSettingsProps {
  value: ClientPrefs;
  onChange: (next: ClientPrefs) => void;
}

export function DevSettings({ value, onChange }: DevSettingsProps): JSX.Element {
  const t = useT();

  return (
    <div className={s.root}>
      <section className={s.section}>
        <header className={s.header}>
          <h3 className={s.title}>{t('dev.erudaTitle')}</h3>
          <p className={s.hint}>{t('dev.erudaHint')}</p>
        </header>
        <Toggle
          checked={value.eruda}
          onCheckedChange={(next) => onChange({ ...value, eruda: next })}
          label={value.eruda ? t('dev.erudaToggleOn') : t('dev.erudaToggleOff')}
        />
      </section>

      <section className={s.section}>
        <header className={s.header}>
          <h3 className={s.title}>{t('dev.consoleBridgeTitle')}</h3>
          <p className={s.hint}>{t('dev.consoleBridgeHint')}</p>
        </header>
        <Toggle
          checked={value.consoleBridge}
          onCheckedChange={(next) => onChange({ ...value, consoleBridge: next })}
          label={value.consoleBridge ? t('dev.consoleBridgeOn') : t('dev.consoleBridgeOff')}
        />
      </section>
    </div>
  );
}
