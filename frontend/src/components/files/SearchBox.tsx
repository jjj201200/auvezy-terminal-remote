/**
 * SearchBox:输入框 + 提交按钮 + Aa/.* toggle + 实时进度 + 取消。
 *
 * 行为:
 *  - 用户在 input 里打字 → 仅更新草稿(`draft`)
 *  - 按下"搜索"按钮或 Enter → onSubmit(draft) 触发实际搜索
 *  - 草稿清空后按 Enter / 提交 → onSubmit('') 退出搜索模式
 *  - toggle Aa / .* 立即生效(不需要再点搜索 — 但只有已提交过才会重发请求,
 *    见父组件的 submittedQ 守卫)
 *
 * 不做即时搜索:服务端限流是真实保护,即时搜索容易撞 429,且每次按键
 *  都新起 SSE 流也无谓。
 */

import { useState, type JSX, type KeyboardEvent } from 'react';
import { IconSearch, IconX } from '@tabler/icons-react';
import { useT } from '../../i18n/i18n-context.js';
import s from './FileBrowserSheet.module.scss';

export interface SearchBoxProps {
  /** 父组件已提交的 q(用作 input 受控初值与同步) */
  submittedQ: string;
  caseSensitive: boolean;
  regex: boolean;
  /** 提交一次搜索 */
  onSubmit: (q: string) => void;
  /** 退出搜索模式(清 input + 关闭搜索结果) */
  onClear: () => void;
  onToggleCase: () => void;
  onToggleRegex: () => void;
  /** 主动 abort 当前流(scanning 中显示) */
  onCancel: () => void;
  scanning: boolean;
  scanned: number;
  hits: number;
}

export function SearchBox(props: SearchBoxProps): JSX.Element {
  const t = useT();
  const [draft, setDraft] = useState(props.submittedQ);

  // 父组件主动清搜索时(切实例 / 重开 sheet),给本组件换 key 强制
  // 重新挂载,useState(props.submittedQ) 初值就是 '' — 草稿自然清空。
  // render 内不做 props → state 反向同步,避免拐弯。

  const submit = (): void => {
    const v = draft.trim();
    if (v.length === 0) {
      props.onClear();
      return;
    }
    props.onSubmit(v);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setDraft('');
      props.onClear();
    }
  };

  return (
    <div className={s.searchBox}>
      <input
        type="text"
        className={s.searchInput}
        placeholder={t('files.searchPlaceholder')}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
      />
      <button
        type="button"
        className={s.searchSubmit}
        onClick={submit}
        aria-label={t('files.searchSubmit')}
        title={t('files.searchSubmit')}
        disabled={props.scanning}
      >
        <IconSearch size={14} stroke={1.5} />
      </button>
      <button
        type="button"
        className={`${s.searchToggle} ${props.caseSensitive ? s.searchToggleActive : ''}`}
        onClick={props.onToggleCase}
        title="case sensitive"
        aria-pressed={props.caseSensitive}
      >
        Aa
      </button>
      <button
        type="button"
        className={`${s.searchToggle} ${props.regex ? s.searchToggleActive : ''}`}
        onClick={props.onToggleRegex}
        title="regex"
        aria-pressed={props.regex}
      >
        .*
      </button>
      {props.scanning && (
        <span className={s.scanning}>
          {t('files.searchScanning', {
            scanned: String(props.scanned),
            hits: String(props.hits),
          })}
        </span>
      )}
      {props.scanning && (
        <button
          type="button"
          className={s.cancelBtn}
          onClick={props.onCancel}
          aria-label={t('files.searchCancel')}
          title={t('files.searchCancel')}
        >
          <IconX size={16} stroke={1.5} />
        </button>
      )}
    </div>
  );
}
