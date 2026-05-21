/**
 * SearchBox — 不做即时搜索(服务端限流是真实保护,逐键 SSE 会撞 429)。
 * 用户提交才触发:Enter / 点搜索按钮 → onSubmit(draft);Enter on 空 → onClear。
 */

import { useState, type JSX, type KeyboardEvent } from 'react';
import { IconSearch, IconX } from '@tabler/icons-react';
import { useT } from '../../i18n/i18n-context.js';
import s from './FileBrowserSheet.module.scss';

export interface SearchBoxProps {
  submittedQ: string;
  caseSensitive: boolean;
  regex: boolean;
  onSubmit: (q: string) => void;
  onClear: () => void;
  onToggleCase: () => void;
  onToggleRegex: () => void;
  onCancel: () => void;
  scanning: boolean;
  scanned: number;
  hits: number;
}

export function SearchBox(props: SearchBoxProps): JSX.Element {
  const t = useT();
  const [draft, setDraft] = useState(props.submittedQ);

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
    <div
      id="file-browser-search"
      className={`${s.searchBox} fb-search`}
      data-scanning={props.scanning ? 'true' : 'false'}
    >
      <input
        type="text"
        id="file-browser-search-input"
        className={`${s.searchInput} fb-search__input`}
        placeholder={t('files.searchPlaceholder')}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
      />
      <button
        type="button"
        className={`${s.searchSubmit} fb-search__submit`}
        data-action="files-search-submit"
        onClick={submit}
        aria-label={t('files.searchSubmit')}
        title={t('files.searchSubmit')}
        disabled={props.scanning}
      >
        <IconSearch size={14} stroke={1.5} />
      </button>
      <button
        type="button"
        className={`${s.searchToggle} ${props.caseSensitive ? s.searchToggleActive : ''} fb-search__toggle fb-search__toggle--case`}
        data-action="files-toggle-case"
        data-active={props.caseSensitive ? 'true' : 'false'}
        onClick={props.onToggleCase}
        title="case sensitive"
        aria-pressed={props.caseSensitive}
      >
        Aa
      </button>
      <button
        type="button"
        className={`${s.searchToggle} ${props.regex ? s.searchToggleActive : ''} fb-search__toggle fb-search__toggle--regex`}
        data-action="files-toggle-regex"
        data-active={props.regex ? 'true' : 'false'}
        onClick={props.onToggleRegex}
        title="regex"
        aria-pressed={props.regex}
      >
        .*
      </button>
      {props.scanning && (
        <span className={`${s.scanning} fb-search__scanning`}>
          {t('files.searchScanning', {
            scanned: String(props.scanned),
            hits: String(props.hits),
          })}
        </span>
      )}
      {props.scanning && (
        <button
          type="button"
          className={`${s.cancelBtn} fb-search__cancel`}
          data-action="files-search-cancel"
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
