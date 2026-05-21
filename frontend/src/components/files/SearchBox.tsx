/**
 * SearchBox:搜索框 + Aa/.* toggle + 实时进度 + 取消。
 *
 * 自动触发条件由调用方决定(典型:>= 3 char);本组件只呈现。
 */

import type { JSX } from 'react';
import { IconX } from '@tabler/icons-react';
import { useT } from '../../i18n/i18n-context.js';
import s from './FileBrowserSheet.module.scss';

export interface SearchBoxProps {
  value: string;
  caseSensitive: boolean;
  regex: boolean;
  onChange: (v: string) => void;
  onToggleCase: () => void;
  onToggleRegex: () => void;
  onCancel: () => void;
  scanning: boolean;
  /** 已扫描数 */
  scanned: number;
  /** 已命中数 */
  hits: number;
}

export function SearchBox(props: SearchBoxProps): JSX.Element {
  const t = useT();
  return (
    <div className={s.searchBox}>
      <input
        type="text"
        className={s.searchInput}
        placeholder={t('files.searchPlaceholder')}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
      />
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
          aria-label="cancel search"
        >
          <IconX size={16} stroke={1.5} />
        </button>
      )}
    </div>
  );
}
