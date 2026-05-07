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
import type { UserConfig } from 'auvezy-terminal-remote-shared';
import { Sheet, type SheetTab } from '../ui/Sheet.js';
import { useT } from '../../i18n/i18n-context.js';
import { ShortcutSettings } from './ShortcutSettings.js';
import { CommandSettings } from './CommandSettings.js';
import { DisplaySettings } from './DisplaySettings.js';
import { NetworkSettings } from './NetworkSettings.js';
import { GeneralSettings } from './GeneralSettings.js';
import { DevSettings } from './DevSettings.js';
import { AboutSettings } from './AboutSettings.js';
import { PushToggle } from '../common/PushToggle.js';
import s from './SettingsModal.module.scss';

export interface SettingsModalProps {
  open: boolean;
  current: UserConfig;
  onSave: (next: UserConfig) => Promise<boolean>;
  onClose: () => void;
}

type TabKey =
  | 'general'
  | 'display'
  | 'shortcuts'
  | 'commands'
  | 'network'
  | 'dev'
  | 'about'
  | 'notifications';

export function SettingsModal({
  open,
  current,
  onSave,
  onClose,
}: SettingsModalProps): JSX.Element {
  const t = useT();
  const [tab, setTab] = useState<TabKey>('general');
  const [draft, setDraft] = useState<UserConfig>(current);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setDraft(current);
      setTab('general');
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
  // 顺序：常识"最一般在最左" → 通用 → 显示 → 快捷键 → 命令 → 网络
  // 通知 tab 暂时隐藏（PushToggle 渲染逻辑保留，方便后续重新暴露）
  const tabs: SheetTab[] = useMemo(
    () => [
      { id: 'general', title: t('settings.tab.general') },
      { id: 'display', title: t('settings.tab.display') },
      { id: 'shortcuts', title: t('settings.tab.shortcuts') },
      { id: 'commands', title: t('settings.tab.commands') },
      { id: 'network', title: t('settings.tab.network') },
      { id: 'dev', title: t('settings.tab.dev') },
      { id: 'about', title: t('settings.tab.about') },
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
        // notifications / dev / about tab 不需要 Save 条
        // - notifications: PushToggle 内部按钮即时生效
        // - dev: 切换写 localStorage，即时生效
        // - about: 纯展示，没有可编辑字段
        tab !== 'notifications' && tab !== 'dev' && tab !== 'about' ? (
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
      {tab === 'general' && <GeneralSettings value={draft} onChange={setDraft} />}
      {tab === 'display' && (
        <DisplaySettings
          value={draft.display}
          onChange={(display) => setDraft({ ...draft, display })}
        />
      )}
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
      {tab === 'network' && (
        <NetworkSettings
          value={draft.network}
          onChange={(network) => setDraft({ ...draft, network })}
        />
      )}
      {tab === 'dev' && <DevSettings />}
      {tab === 'about' && <AboutSettings />}
      {tab === 'notifications' && <PushToggle />}
    </Sheet>
  );
}
