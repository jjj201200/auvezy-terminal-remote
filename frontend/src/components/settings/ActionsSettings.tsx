/**
 * ActionsSettings
 *
 * "操作" tab 容器：所有 section 平铺，标题用同一种 H3 风格。
 *  顺序：输入方式 → TUI 滚动 → 每次滚动行数 → 快捷键 → 命令。
 *
 *  - 前三个 section 在 ControlsSection 内（共用 GeneralSettings.module.scss
 *    的 section/header/title/hint 样式）
 *  - 后两个 section 用嵌套树形态：内部派生 ShortcutGroup[] / CommandGroup[]
 *    给子组件做 CRUD；保存时 split 回 flat + meta 同步写回 UserConfig
 */

import { useMemo, type JSX } from 'react';
import {
  type UserConfig,
  type ShortcutGroup,
  type CommandGroup,
  migrateShortcutsToTree,
  migrateCommandsToTree,
  splitShortcutTree,
  splitCommandTree,
} from 'auvezy-terminal-remote-shared';
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

  // 派生嵌套树：UserConfig 是 source of truth，每次重新 migrate
  // （体积小、纯函数、无副作用；不引 useState 避免双源同步问题）
  const shortcutGroups = useMemo(
    () => migrateShortcutsToTree(value.shortcuts, value.actionGroupMeta?.shortcuts),
    [value.shortcuts, value.actionGroupMeta?.shortcuts],
  );
  const commandGroups = useMemo(
    () => migrateCommandsToTree(value.commands, value.actionGroupMeta?.commands),
    [value.commands, value.actionGroupMeta?.commands],
  );

  const handleShortcutsChange = (next: ShortcutGroup[]): void => {
    const { flat, meta } = splitShortcutTree(next);
    onChange({
      ...value,
      shortcuts: flat,
      actionGroupMeta: {
        ...value.actionGroupMeta,
        shortcuts: meta,
      },
    });
  };

  const handleCommandsChange = (next: CommandGroup[]): void => {
    const { flat, meta } = splitCommandTree(next);
    onChange({
      ...value,
      commands: flat,
      actionGroupMeta: {
        ...value.actionGroupMeta,
        commands: meta,
      },
    });
  };

  return (
    <div className={gs.root}>
      <ControlsSection value={value} onChange={onChange} />

      <section className={gs.section}>
        <header className={gs.header}>
          <h3 className={gs.title}>{t('actions.sectionShortcuts')}</h3>
        </header>
        <ShortcutSettings groups={shortcutGroups} onChange={handleShortcutsChange} />
      </section>

      <section className={gs.section}>
        <header className={gs.header}>
          <h3 className={gs.title}>{t('actions.sectionCommands')}</h3>
        </header>
        <CommandSettings groups={commandGroups} onChange={handleCommandsChange} />
      </section>
    </div>
  );
}
