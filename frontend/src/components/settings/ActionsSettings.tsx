/**
 * ActionsSettings
 *
 * "操作" tab 容器：所有 section 平铺，标题用同一种 H3 风格。
 *  顺序：输入方式 → TUI 滚动 → 每次滚动行数 → 快捷键 → 命令。
 *
 *  - 前三个 section 在 ControlsSection 内（共用 GeneralSettings.module.scss
 *    的 section/header/title/hint 样式）
 *  - 后两个 section 在这里包一层标题，内容沿用 ShortcutSettings / CommandSettings
 */

import type { JSX } from 'react';
import type { UserConfig } from 'auvezy-terminal-remote-shared';
import { useT } from '../../i18n/i18n-context.js';
import { ControlsSection } from './ControlsSection.js';
import { ShortcutSettings } from './ShortcutSettings.js';
import { CommandSettings } from './CommandSettings.js';
import gs from './GeneralSettings.module.scss';

export interface ActionsSettingsProps {
  value: UserConfig;
  onChange: (next: UserConfig) => void;
}

export function ActionsSettings({ value, onChange }: ActionsSettingsProps): JSX.Element {
  const t = useT();
  return (
    <div className={gs.root}>
      <ControlsSection value={value} onChange={onChange} />

      <section className={gs.section}>
        <header className={gs.header}>
          <h3 className={gs.title}>{t('actions.sectionShortcuts')}</h3>
        </header>
        <ShortcutSettings
          value={value.shortcuts ?? []}
          onChange={(shortcuts) => onChange({ ...value, shortcuts })}
        />
      </section>

      <section className={gs.section}>
        <header className={gs.header}>
          <h3 className={gs.title}>{t('actions.sectionCommands')}</h3>
        </header>
        <CommandSettings
          value={value.commands ?? []}
          onChange={(commands) => onChange({ ...value, commands })}
        />
      </section>
    </div>
  );
}
