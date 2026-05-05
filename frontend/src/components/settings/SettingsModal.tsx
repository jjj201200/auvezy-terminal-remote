/**
 * SettingsModal
 *
 * 设置面板：桌面 modal / 移动 sheet（共用 Sheet primitive）。
 * 三个 tab：快捷键 / 命令 / 通知。
 *
 * 编辑模型：本地草稿（draft）→ 保存按钮 PUT；保存失败弹 alert（toast 系统未来引入）。
 * 「通知」tab 不需要保存按钮（PushToggle 内部按钮即生效），所以 footer 在该 tab 下不渲染。
 */

import { useEffect, useMemo, useState, type JSX } from 'react';
import type { UserConfig } from '@otr/shared';
import { Sheet, type SheetTab } from '../ui/Sheet.js';
import { useT } from '../../i18n/i18n-context.js';
import { LanguageSwitch } from '../../i18n/LanguageSwitch.js';
import { ShortcutSettings } from './ShortcutSettings.js';
import { CommandSettings } from './CommandSettings.js';
import { DisplaySettings } from './DisplaySettings.js';
import { PushToggle } from '../common/PushToggle.js';
import s from './SettingsModal.module.scss';

export interface SettingsModalProps {
  open: boolean;
  current: UserConfig;
  onSave: (next: UserConfig) => Promise<boolean>;
  onClose: () => void;
}

type TabKey = 'shortcuts' | 'commands' | 'display' | 'general' | 'notifications';

export function SettingsModal({
  open,
  current,
  onSave,
  onClose,
}: SettingsModalProps): JSX.Element {
  const t = useT();
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
    else alert(t('settings.saveError'));
  };

  // tabs 直接喂给 Sheet header（用 ScrollableTabs 自带溢出处理，与 Toolbar 同款）
  const tabs: SheetTab[] = useMemo(
    () => [
      { id: 'shortcuts', title: t('settings.tab.shortcuts') },
      { id: 'commands', title: t('settings.tab.commands') },
      { id: 'display', title: t('settings.tab.display') },
      { id: 'general', title: t('settings.tab.general') },
      { id: 'notifications', title: t('settings.tab.notifications') },
    ],
    [t],
  );

  return (
    <Sheet
      id="settings-modal"
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={t('settings.title')}
      tabs={tabs}
      activeTab={tab}
      onTabChange={(id) => setTab(id as TabKey)}
      footer={
        tab !== 'notifications' && tab !== 'general' ? (
          <>
            <button type="button" onClick={onClose} className={s.cancelBtn}>
              {t('common.cancel')}
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => void handleSave()}
              className={s.saveBtn}
            >
              {saving ? t('settings.saving') : t('common.save')}
            </button>
          </>
        ) : undefined
      }
    >
      {tab === 'shortcuts' && (
        <ShortcutSettings
          value={draft.shortcuts ?? []}
          onChange={(shortcuts) => setDraft({ ...draft, shortcuts })}
        />
      )}
      {tab === 'commands' && (
        <CommandSettings
          value={draft.commands ?? []}
          onChange={(commands) => setDraft({ ...draft, commands })}
        />
      )}
      {tab === 'display' && (
        <DisplaySettings
          value={draft.display}
          onChange={(display) => setDraft({ ...draft, display })}
        />
      )}
      {tab === 'general' && <LanguageSwitch />}
      {tab === 'notifications' && <PushToggle />}
    </Sheet>
  );
}
