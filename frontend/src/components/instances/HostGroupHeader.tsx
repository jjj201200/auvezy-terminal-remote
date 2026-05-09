/**
 * HostGroupHeader
 *
 * 主机分组小标题：显示 host 的 displayName（用户 alias 或 host 原值），
 * 点击切到 inline 重命名输入框（Enter 保存 / Esc 取消）。
 *
 * 当前只在 ≥ 2 个 host group 时显示（避免单主机场景视觉冗余）。
 * 调用方决定是否渲染（hasSingleHost ? null : <HostGroupHeader .../>）。
 */

import { useEffect, useRef, useState, type FocusEvent, type JSX, type KeyboardEvent } from 'react';
import { IconPencil, IconCheck, IconX } from '@tabler/icons-react';
import clsx from 'clsx';
import { useT } from '../../i18n/i18n-context.js';
import { setHostAlias } from '../../services/host-aliases.js';
import { useConfirm } from '../ui/ConfirmProvider.js';
import s from './HostGroupHeader.module.scss';

export interface HostGroupHeaderProps {
  host: string;
  displayName: string;
  hasAlias: boolean;
  /** 重命名后回调（让父组件 forceUpdate / 重新读 alias） */
  onRenamed?: () => void;
  /** 紧凑模式：移动端 sheet 内用更小的 padding */
  compact?: boolean;
}

export function HostGroupHeader({
  host,
  displayName,
  hasAlias,
  onRenamed,
  compact = false,
}: HostGroupHeaderProps): JSX.Element {
  const t = useT();
  const confirm = useConfirm();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const rowRef = useRef<HTMLDivElement | null>(null);
  // save / reset 进行中：confirm modal 让 input 失焦，blur 不应触发 cancel
  const savingRef = useRef(false);

  // 进入编辑模式时：填充 draft（已有 alias 用现值，否则空）+ focus + 全选
  // 不依赖 displayName/hasAlias，避免编辑期间外部值变化又 focus 抢回
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (editing) {
      setDraft(hasAlias ? displayName : '');
      setError(null);
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    }
  }, [editing]);

  const save = async (): Promise<void> => {
    const trimmed = draft.trim();
    if (trimmed.length === 0) {
      // 空字符串 → inline 错误提示，不允许保存
      setError(t('instance.hostRenameEmptyError'));
      inputRef.current?.focus();
      return;
    }
    // 与现值相同 → 视为无操作
    if (hasAlias && trimmed === displayName) {
      setEditing(false);
      return;
    }
    savingRef.current = true;
    try {
      const ok = await confirm({
        title: t('instance.hostRenameTitle'),
        messageTemplate: t('instance.hostRenameConfirm'),
        messageVars: { host, alias: trimmed },
        highlightVar: 'alias',
      });
      if (!ok) {
        // 用户取消 confirm：保留编辑态让其继续改 / 或自己点 ×
        inputRef.current?.focus();
        return;
      }
      setHostAlias(host, trimmed);
      setEditing(false);
      onRenamed?.();
    } finally {
      savingRef.current = false;
    }
  };

  const cancel = (): void => {
    setEditing(false);
    setError(null);
  };

  const reset = async (): Promise<void> => {
    savingRef.current = true;
    try {
      const ok = await confirm({
        title: t('instance.hostRenameReset'),
        messageTemplate: t('instance.hostRenameResetConfirm'),
        messageVars: { host },
        highlightVar: 'host',
        tone: 'danger',
      });
      if (!ok) {
        inputRef.current?.focus();
        return;
      }
      setHostAlias(host, '');
      setEditing(false);
      onRenamed?.();
    } finally {
      savingRef.current = false;
    }
  };

  const handleKey = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void save();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancel();
    }
  };

  // 失焦自动退出编辑（放弃改动，等同 Esc / 点 ×）
  // 例外：
  //  - 点本行内的 ✓ / × / ↺ 按钮 → relatedTarget 仍在 row 内，不退出，让 click 决定
  //  - save / reset 进行中（confirm modal 抢焦点） → 不退出，等用户决议
  const handleBlur = (e: FocusEvent<HTMLInputElement>): void => {
    if (savingRef.current) return;
    const next = e.relatedTarget as Node | null;
    if (next && rowRef.current?.contains(next)) return;
    cancel();
  };

  if (editing) {
    return (
      <div ref={rowRef} className={clsx(s.row, s.editing, compact && s.compact)}>
        <input
          ref={inputRef}
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKey}
          onBlur={handleBlur}
          placeholder={t('instance.hostRenamePlaceholder')}
          aria-label={t('instance.hostRenameTitle')}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          className={s.input}
        />
        <button
          type="button"
          onClick={() => { void save(); }}
          aria-label={t('common.confirm') ?? 'Confirm'}
          title={t('common.confirm') ?? 'Confirm'}
          className={s.iconBtn}
        >
          <IconCheck size={12} stroke={1.8} />
        </button>
        <button
          type="button"
          onClick={cancel}
          aria-label={t('common.cancel')}
          title={t('common.cancel')}
          className={s.iconBtn}
        >
          <IconX size={12} stroke={1.8} />
        </button>
        {hasAlias && (
          <button
            type="button"
            onClick={() => { void reset(); }}
            title={t('instance.hostRenameReset')}
            className={s.resetBtn}
          >
            ↺
          </button>
        )}
        {error && <span className={s.errorText}>{error}</span>}
      </div>
    );
  }

  return (
    <div className={clsx(s.row, compact && s.compact)}>
      <button
        type="button"
        onClick={() => setEditing(true)}
        title={t('instance.hostRename')}
        aria-label={t('instance.hostRename')}
        className={s.nameBtn}
      >
        <span className={s.host}>{displayName}</span>
        {hasAlias && <span className={s.rawHost}>{host}</span>}
        <IconPencil size={10} stroke={1.5} className={s.editIcon} />
      </button>
    </div>
  );
}
