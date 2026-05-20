/**
 * SearchResults:文件搜索命中列表
 *
 * 设计:把 name 命中与 content 命中分组渲染,各自有视觉区分:
 *  - name:仅一行 path(图标 📄)
 *  - content:path:line 标签 + 命中行 preview(命中区间 <mark> 高亮)
 *
 * 命中条目点击 → 调用方决定如何打开预览(关搜索回 list、或在结果区直接预览)。
 */

import type { JSX } from 'react';
import type { SearchEvent } from 'auvezy-terminal-remote-shared';
import { useT } from '../../i18n/i18n-context.js';
import s from './FileBrowserSheet.module.scss';

export interface SearchResultsProps {
  hits: SearchEvent[];
  truncated: boolean;
  onPick: (hit: SearchEvent) => void;
}

export function SearchResults({ hits, truncated, onPick }: SearchResultsProps): JSX.Element {
  const t = useT();
  if (hits.length === 0 && !truncated) {
    return <div className={s.empty}>{t('files.searchEmpty')}</div>;
  }
  const nameHits = hits.filter((h): h is Extract<SearchEvent, { kind: 'name' }> => h.kind === 'name');
  const contentHits = hits.filter((h): h is Extract<SearchEvent, { kind: 'content' }> => h.kind === 'content');
  return (
    <ul className={s.searchList}>
      {nameHits.map((h, i) => (
        <li key={`n-${i}`} onClick={() => onPick(h)}>
          <span aria-hidden>📄</span>
          <span className={s.name}>{h.path}</span>
        </li>
      ))}
      {contentHits.map((h, i) => {
        const before = h.preview.slice(0, h.matchStart);
        const match = h.preview.slice(h.matchStart, h.matchEnd);
        const after = h.preview.slice(h.matchEnd);
        return (
          <li key={`c-${i}`} onClick={() => onPick(h)}>
            <span className={s.path}>{h.path}:{h.line}</span>
            <code>{before}<mark>{match}</mark>{after}</code>
          </li>
        );
      })}
      {truncated && (
        <li className={s.notice}>{t('files.searchTruncated')}</li>
      )}
    </ul>
  );
}
