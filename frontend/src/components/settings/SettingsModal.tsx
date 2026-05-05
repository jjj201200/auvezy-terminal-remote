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
import type { UserConfig } from '@ocr/shared';
import { Sheet } from '../ui/Sheet.js';
import { ShortcutSettings } from './ShortcutSettings.js';
import { CommandSettings } from './CommandSettings.js';
import { PushToggle } from '../common/PushToggle.js';
import { cn } from '../../utils/cn.js';

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

  const tabBtnClass = (key: TabKey): string =>
    cn(
      'border-b-2 px-3 py-2 text-sm transition-colors',
      tab === key
        ? 'border-[var(--color-accent)] text-[var(--color-fg)] font-medium'
        : 'border-transparent text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]',
    );

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title="设置"
      footer={
        tab !== 'notifications' ? (
          <>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-[var(--color-border)] bg-transparent px-3 py-1.5 text-sm text-[var(--color-fg)] hover:bg-[var(--color-bg)]"
            >
              取消
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => void handleSave()}
              className="rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-sm font-medium text-[#0d1117] disabled:opacity-50"
            >
              {saving ? '保存中…' : '保存'}
            </button>
          </>
        ) : undefined
      }
    >
      <Tabs.Root
        value={tab}
        onValueChange={(v) => setTab(v as TabKey)}
        className="flex flex-col gap-3"
      >
        <Tabs.List className="flex border-b border-[var(--color-border)]">
          <Tabs.Trigger value="shortcuts" className={tabBtnClass('shortcuts')}>
            快捷键
          </Tabs.Trigger>
          <Tabs.Trigger value="commands" className={tabBtnClass('commands')}>
            命令
          </Tabs.Trigger>
          <Tabs.Trigger value="notifications" className={tabBtnClass('notifications')}>
            通知
          </Tabs.Trigger>
        </Tabs.List>

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
      </Tabs.Root>
    </Sheet>
  );
}
