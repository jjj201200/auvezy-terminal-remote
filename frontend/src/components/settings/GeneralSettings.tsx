/**
 * GeneralSettings
 *
 * "通用" tab：只放语言切换。其它"输入方式 / TUI 滚动 / 滚动行数"已挪到
 * "操作"tab 的 ControlsSection 里（按用户语义"操作运行时行为"归类）。
 */

import type { JSX } from 'react';
import { LanguageSwitch } from '../../i18n/LanguageSwitch.js';
import s from './GeneralSettings.module.scss';

export function GeneralSettings(): JSX.Element {
  return (
    <div className={s.root}>
      <LanguageSwitch />
    </div>
  );
}
