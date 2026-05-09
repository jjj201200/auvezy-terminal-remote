/**
 * GeneralSettings
 *
 * "通用" tab：只放语言切换。其它"输入方式 / TUI 滚动 / 滚动行数"已挪到
 * "操作"tab 的 ControlsSection 里（按用户语义"操作运行时行为"归类）。
 *
 * 受控：locale 由 SettingsModal 草稿持有，"保存"按钮按下后才真正切换。
 */

import type { JSX } from 'react';
import { LanguageSwitch } from '../../i18n/LanguageSwitch.js';
import type { Locale } from '../../i18n/messages.js';
import s from './GeneralSettings.module.scss';

export interface GeneralSettingsProps {
  value: Locale;
  onChange: (next: Locale) => void;
}

export function GeneralSettings({ value, onChange }: GeneralSettingsProps): JSX.Element {
  return (
    <div className={s.root}>
      <LanguageSwitch value={value} onChange={onChange} />
    </div>
  );
}
