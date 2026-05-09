/**
 * ActionsSettings
 *
 * "操作" tab 容器：上方放即时控制项（输入方式 / TUI 滚动 / 滚动行数），
 * 下方放快捷键 / 命令两张卡片——卡片只显示标题 + 简短说明 + 启用计数 +
 * "详细设置"按钮，点击进入二层 modal 管理具体分组与项。
 *
 * 编辑模型与"集成"tab 一致：所有改动直接写回父级 SettingsModal 的 draft，
 * 子 modal 关闭不丢改动；保存由父级"应用"按钮统一触发。
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
import {
  useShortcutSettingsPresenter,
  useCommandSettingsPresenter,
} from '../ui/modal-stack/presenters.js';
import gs from './GeneralSettings.module.scss';

export interface ActionsSettingsProps {
  value: UserConfig;
  onChange: (next: UserConfig) => void;
}

/** 数 group[].items 中 enabled 的总数 */
function countEnabled<T extends { items: ReadonlyArray<{ enabled: boolean }> }>(
  groups: ReadonlyArray<T>,
): { active: number; total: number } {
  let active = 0;
  let total = 0;
  for (const g of groups) {
    for (const it of g.items) {
      total++;
      if (it.enabled) active++;
    }
  }
  return { active, total };
}

export function ActionsSettings({ value, onChange }: ActionsSettingsProps): JSX.Element {
  const t = useT();
  const presentShortcuts = useShortcutSettingsPresenter();
  const presentCommands = useCommandSettingsPresenter();

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
      actionGroupMeta: { ...value.actionGroupMeta, shortcuts: meta },
    });
  };
  const handleCommandsChange = (next: CommandGroup[]): void => {
    const { flat, meta } = splitCommandTree(next);
    onChange({
      ...value,
      commands: flat,
      actionGroupMeta: { ...value.actionGroupMeta, commands: meta },
    });
  };

  return (
    <div className={gs.root}>
      <ControlsSection value={value} onChange={onChange} />

      <ActionCard
        title={t('actions.sectionShortcuts')}
        hint={t('actions.shortcutsHint')}
        countLabel={t('actions.countActive', countEnabled(shortcutGroups))}
        onOpen={() => presentShortcuts({ value: shortcutGroups, onChange: handleShortcutsChange })}
      />

      <ActionCard
        title={t('actions.sectionCommands')}
        hint={t('actions.commandsHint')}
        countLabel={t('actions.countActive', countEnabled(commandGroups))}
        onOpen={() => presentCommands({ value: commandGroups, onChange: handleCommandsChange })}
      />
    </div>
  );
}

/** 模块卡片：标题 + 计数 + 描述 + "详细设置"按钮，与 IntegrationsSettings 卡片同源 */
function ActionCard(props: {
  title: string;
  hint: string;
  countLabel: string;
  onOpen: () => void;
}): JSX.Element {
  const t = useT();
  return (
    <section className={gs.section}>
      <header className={gs.header}>
        <h3 className={gs.title}>
          {props.title}
          <span className={gs.titleStatus} data-tone="muted">
            {props.countLabel}
          </span>
        </h3>
        <p className={gs.hint}>{props.hint}</p>
      </header>
      <div className={gs.row}>
        <button type="button" onClick={props.onOpen} className={gs.btn}>
          {t('actions.openDetails')}
        </button>
      </div>
    </section>
  );
}
