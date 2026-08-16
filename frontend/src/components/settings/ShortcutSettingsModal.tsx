/**
 * ShortcutSettingsModal
 *
 * 快捷键管理子 modal。从「操作」tab 的快捷键卡片"详细设置"按钮进入,
 * 叠加在 SettingsModal 之上(走 ModalStack)。
 *
 * 编辑模型与 ClaudeCodeSettingsModal 同：受控 value/onChange,直接回写
 * 父 SettingsModal 的 draft;父级"应用 / 保存"接管真正写盘,本 modal 只
 * 关闭不丢改动。
 *
 * 内部组合:简短说明 + 现成的 ShortcutSettings 树形组件。
 */

import { useState, type JSX } from 'react';
import { type ShortcutGroup } from 'auvezy-terminal-remote-shared';
import { Sheet } from '../ui/Sheet.js';
import { useT } from '../../i18n/i18n-context.js';
import { ShortcutSettings } from './ShortcutSettings.js';
import s from './GeneralSettings.module.scss';

export interface ShortcutSettingsModalProps {
  open: boolean;
  onClose: () => void;
  /** 快捷键分组树 */
  value: ShortcutGroup[];
  /** 改动回调,直接写回父 draft */
  onChange: (next: ShortcutGroup[]) => void;
}

export function ShortcutSettingsModal({
  open,
  onClose,
  value,
  onChange,
}: ShortcutSettingsModalProps): JSX.Element {
  const t = useT();

  // modal-stack 的 entry render 闭包在 present() 时固化 props,父级 draft 之后
  // 再变也不会送来新 value(受控直连会让编辑不显示 / 连续编辑互相覆盖)。
  // 因此编辑态在这里持有:mount 时用快照播种,之后所有变更基于本地态累积,
  // 每次变更同步上报 onChange —— 父 draft 仍实时跟进,关闭不丢改动的模型不变。
  const [local, setLocal] = useState<ShortcutGroup[]>(value);

  const handleChange = (next: ShortcutGroup[]): void => {
    setLocal(next);
    onChange(next);
  };

  return (
    <Sheet
      id="shortcut-settings-modal"
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={t('actions.shortcutsModalTitle')}
    >
      <div className={s.root}>
        <p className={s.hint}>{t('actions.shortcutsModalHint')}</p>
        <ShortcutSettings groups={local} onChange={handleChange} />
      </div>
    </Sheet>
  );
}
