/**
 * DevSettings
 *
 * 开发者选项。仅本设备生效(client prefs,写 localStorage)。
 * 切换后需刷新页面才能生效(开关在 main.tsx 启动时被读取)。
 *
 * 受控:外部(SettingsModal)持有草稿,本组件只渲染并 onChange 上报。保存
 * 由 SettingsModal 的"保存"按钮统一触发,与其它 tab 一致。
 *
 * UI 风格:每项一个 BoolToggleRow(标题 + hint + 开关双按钮),与"操作" /
 * "集成"tab 视觉一致。需要刷新提示用 info 蓝 note。
 */

import type { JSX } from 'react';
import { BoolToggleRow } from './BoolToggleRow.js';
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
      <BoolToggleRow
        title={t('dev.erudaTitle')}
        hint={t('dev.erudaHint')}
        value={value.eruda}
        onChange={(next) => onChange({ ...value, eruda: next })}
        note={{ tone: 'info', text: t('dev.reloadHint') }}
      />
      <BoolToggleRow
        title={t('dev.consoleBridgeTitle')}
        hint={t('dev.consoleBridgeHint')}
        value={value.consoleBridge}
        onChange={(next) => onChange({ ...value, consoleBridge: next })}
        note={{ tone: 'info', text: t('dev.reloadHint') }}
      />
    </div>
  );
}
