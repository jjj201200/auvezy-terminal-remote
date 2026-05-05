/**
 * SettingsModal
 *
 * 设置面板：桌面 modal / 移动 sheet（共用 Sheet primitive）。
 * 三个 tab：快捷键 / 命令 / 通知。
 *
 * 编辑模型：本地草稿（draft）→ 保存按钮 PUT；保存失败弹 alert（toast 系统未来引入）。
 * 「通知」tab 不需要保存按钮（PushToggle 内部按钮即生效），所以 footer 在该 tab 下不渲染。
 */

import { useEffect, useState, type JSX } from 'react';
import * as Tabs from '@radix-ui/react-tabs';
import type { UserConfig } from '@otr/shared';
import clsx from 'clsx';
import { Sheet } from '../ui/Sheet.js';
import { ShortcutSettings } from './ShortcutSettings.js';
import { CommandSettings } from './CommandSettings.js';
import { PushToggle } from '../common/PushToggle.js';
import s from './SettingsModal.module.scss';

export interface SettingsModalProps {
  open: boolean;
  current: UserConfig;
  onSave: (next: UserConfig) => Promise<boolean>;
  onClose: () => void;
}

type TabKey = 'shortcuts' | 'commands' | 'notifications';

export function SettingsModal({
  open,
  current,
  onSave,
  onClose,
}: SettingsModalProps): JSX.Element {
  const [tab, setTab] = useState<TabKey>('shortcuts');
  const [draft, setDraft] = useState<UserConfig>(current);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setDraft(current);
      setTab('shortcuts');
    }
  }, [open, current]);

  const handleSave = async (): Promise<void> => {
    setSaving(true);
    const ok = await onSave(draft);
    setSaving(false);
    if (ok) onClose();
    else alert('保存失败，请稍后重试');
  };

  const tabBtnCls = (key: TabKey): string =>
    clsx(s.tabBtn, tab === key && s.tabBtnActive);

  return (
    <Tabs.Root
      value={tab}
      onValueChange={(v) => setTab(v as TabKey)}
    >
      <Sheet
        id="settings-modal"
        open={open}
        onOpenChange={(next) => {
          if (!next) onClose();
        }}
        title="设置"
        headerExtra={
          <Tabs.List className={s.tabsList}>
            <Tabs.Trigger value="shortcuts" className={tabBtnCls('shortcuts')}>
              快捷键
            </Tabs.Trigger>
            <Tabs.Trigger value="commands" className={tabBtnCls('commands')}>
              命令
            </Tabs.Trigger>
            <Tabs.Trigger value="notifications" className={tabBtnCls('notifications')}>
              通知
            </Tabs.Trigger>
          </Tabs.List>
        }
        footer={
          tab !== 'notifications' ? (
            <>
              <button type="button" onClick={onClose} className={s.cancelBtn}>
                取消
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => void handleSave()}
                className={s.saveBtn}
              >
                {saving ? '保存中…' : '保存'}
              </button>
            </>
          ) : undefined
        }
      >
        <Tabs.Content value="shortcuts">
          <ShortcutSettings
            value={draft.shortcuts ?? []}
            onChange={(shortcuts) => setDraft({ ...draft, shortcuts })}
          />
        </Tabs.Content>
        <Tabs.Content value="commands">
          <CommandSettings
            value={draft.commands ?? []}
            onChange={(commands) => setDraft({ ...draft, commands })}
          />
        </Tabs.Content>
        <Tabs.Content value="notifications">
          <PushToggle />
        </Tabs.Content>
      </Sheet>
    </Tabs.Root>
  );
}
