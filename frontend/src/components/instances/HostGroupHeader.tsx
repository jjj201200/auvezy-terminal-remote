/**
 * HostGroupHeader
 *
 * 主机分组小标题：显示 host 的 displayName（用户 alias 或 host 原值），
 * 点击切到 inline 重命名输入框（Enter 保存 / Esc 取消）。
 *
 * 当前只在 ≥ 2 个 host group 时显示（避免单主机场景视觉冗余）。
 * 调用方决定是否渲染（hasSingleHost ? null : <HostGroupHeader .../>）。
 */

import { useEffect, useRef, useState, type JSX, type KeyboardEvent } from 'react';
import { IconPencil, IconCheck, IconX } from '@tabler/icons-react';
import clsx from 'clsx';
import { useT } from '../../i18n/i18n-context.js';
import { setHostAlias } from '../../services/host-aliases.js';
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
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (editing) {
      setDraft(hasAlias ? displayName : '');
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [editing, displayName, hasAlias]);

  const save = (): void => {
    setHostAlias(host, draft);
    setEditing(false);
    onRenamed?.();
  };

  const cancel = (): void => {
    setEditing(false);
  };

  const reset = (): void => {
    setHostAlias(host, '');
    setEditing(false);
    onRenamed?.();
  };

  const handleKey = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') {
      e.preventDefault();
      save();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancel();
    }
  };

  if (editing) {
    return (
      <div className={clsx(s.row, s.editing, compact && s.compact)}>
        <input
          ref={inputRef}
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKey}
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
          onClick={save}
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
            onClick={reset}
            title={t('instance.hostRenameReset')}
            className={s.resetBtn}
          >
            ↺
          </button>
        )}
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
