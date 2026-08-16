/**
 * CommandSettingsModal
 *
 * 命令管理子 modal。结构与 ShortcutSettingsModal 同源,差异仅在于内嵌组件
 * 是 CommandSettings(命令分组树)。
 */

import { useState, type JSX } from 'react';
import { type CommandGroup } from 'auvezy-terminal-remote-shared';
import { Sheet } from '../ui/Sheet.js';
import { useT } from '../../i18n/i18n-context.js';
import { CommandSettings } from './CommandSettings.js';
import s from './GeneralSettings.module.scss';

export interface CommandSettingsModalProps {
  open: boolean;
  onClose: () => void;
  /** 命令分组树 */
  value: CommandGroup[];
  /** 改动回调,直接写回父 draft */
  onChange: (next: CommandGroup[]) => void;
}

export function CommandSettingsModal({
  open,
  onClose,
  value,
  onChange,
}: CommandSettingsModalProps): JSX.Element {
  const t = useT();

  // 与 ShortcutSettingsModal 同因:modal-stack entry 固化 present() 时的 props,
  // 编辑态必须在 modal 内部持有(mount 快照播种 + 变更累积 + 同步上报 onChange)。
  const [local, setLocal] = useState<CommandGroup[]>(value);

  const handleChange = (next: CommandGroup[]): void => {
    setLocal(next);
    onChange(next);
  };

  return (
    <Sheet
      id="command-settings-modal"
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={t('actions.commandsModalTitle')}
    >
      <div className={s.root}>
        <p className={s.hint}>{t('actions.commandsModalHint')}</p>
        <CommandSettings groups={local} onChange={handleChange} />
      </div>
    </Sheet>
  );
}
