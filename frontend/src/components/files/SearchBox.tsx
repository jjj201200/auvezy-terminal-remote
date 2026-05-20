/**
 * SearchBox:文件浏览面板顶部搜索框 + 模式 toggle + 实时进度。
 *
 * 自动触发条件由调用方决定(典型:>= 3 char),本组件只负责呈现。
 */

import type { JSX } from 'react';
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
        placeholder={t('files.searchPlaceholder')}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
      />
      <label className={s.searchToggle}>
        <input
          type="checkbox"
          checked={props.caseSensitive}
          onChange={props.onToggleCase}
        />
        Aa
      </label>
      <label className={s.searchToggle}>
        <input
          type="checkbox"
          checked={props.regex}
          onChange={props.onToggleRegex}
        />
        .*
      </label>
      {props.scanning && (
        <span className={s.scanning}>
          {t('files.searchScanning', {
            scanned: String(props.scanned),
            hits: String(props.hits),
          })}
        </span>
      )}
      {props.scanning && (
        <button type="button" onClick={props.onCancel} aria-label="cancel search">×</button>
      )}
    </div>
  );
}
