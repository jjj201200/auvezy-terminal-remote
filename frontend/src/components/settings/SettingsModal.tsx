/**
 * SettingsModal
 *
 * 设置面板：覆盖屏幕的简单 modal，含两个 tab：快捷键 / 命令。
 *
 * 阶段 4 仅做最小可用：
 *  - 不做拖拽排序（@dnd-kit 留到阶段 4 之后或手动调整 order 字段）
 *  - 编辑模型：本地草稿（draft）→ 保存按钮 PUT
 *  - 取消 / 保存按钮均关闭 modal；保存失败时弹 alert（toast 系统在阶段 9 引入）
 */

import { useEffect, useState, type JSX } from 'react';
import type { UserConfig } from '@ocr/shared';
import { ShortcutSettings } from './ShortcutSettings.js';
import { CommandSettings } from './CommandSettings.js';

export interface SettingsModalProps {
  /** 是否显示 */
  open: boolean;
  /** 当前生效的配置（来自 useUserConfig） */
  current: UserConfig;
  /** 用户点保存：触发 useUserConfig.save；返回是否成功 */
  onSave: (next: UserConfig) => Promise<boolean>;
  /** 关闭面板（取消或保存成功后调用） */
  onClose: () => void;
}

type Tab = 'shortcuts' | 'commands';

export function SettingsModal({
  open,
  current,
  onSave,
  onClose,
}: SettingsModalProps): JSX.Element | null {
  const [tab, setTab] = useState<Tab>('shortcuts');
  const [draft, setDraft] = useState<UserConfig>(current);
  const [saving, setSaving] = useState(false);

  // 每次重新打开 modal 都把 draft 重置为最新值
  useEffect(() => {
    if (open) {
      setDraft(current);
      setTab('shortcuts');
    }
  }, [open, current]);

  if (!open) return null;

  const handleSave = async (): Promise<void> => {
    setSaving(true);
    const ok = await onSave(draft);
    setSaving(false);
    if (ok) {
      onClose();
    } else {
      // 错误显示由 useUserConfig 内的 error 字段在外层呈现，这里仅简单提示
      alert('保存失败，请稍后重试');
    }
  };

  return (
    <div
      className="settings-modal__backdrop"
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="settings-modal__panel">
        <header className="settings-modal__header">
          <h2 className="settings-modal__title">设置</h2>
          <button
            type="button"
            className="settings-modal__close"
            onClick={onClose}
            aria-label="关闭"
          >
            ×
          </button>
        </header>

        <nav className="settings-modal__tabs">
          <button
            type="button"
            className={`settings-modal__tab ${tab === 'shortcuts' ? 'settings-modal__tab--active' : ''}`}
            onClick={() => setTab('shortcuts')}
          >
            快捷键
          </button>
          <button
            type="button"
            className={`settings-modal__tab ${tab === 'commands' ? 'settings-modal__tab--active' : ''}`}
            onClick={() => setTab('commands')}
          >
            命令
          </button>
        </nav>

        <main className="settings-modal__body">
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
        </main>

        <footer className="settings-modal__footer">
          <button
            type="button"
            className="settings-modal__btn settings-modal__btn--ghost"
            onClick={onClose}
          >
            取消
          </button>
          <button
            type="button"
            className="settings-modal__btn settings-modal__btn--primary"
            disabled={saving}
            onClick={() => void handleSave()}
          >
            {saving ? '保存中…' : '保存'}
          </button>
        </footer>
      </div>
    </div>
  );
}
