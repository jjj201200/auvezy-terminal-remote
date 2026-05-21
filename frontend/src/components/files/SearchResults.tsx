/**
 * SearchResults:搜索命中列表(name + content 分组,content 高亮命中区间)。
 */

import type { JSX } from 'react';
import { IconFileText, IconSearch } from '@tabler/icons-react';
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
          <span className={s.resultName}>
            <IconFileText size={14} stroke={1.5} />
            <span>{h.path}</span>
          </span>
        </li>
      ))}
      {contentHits.map((h, i) => {
        const before = h.preview.slice(0, h.matchStart);
        const match = h.preview.slice(h.matchStart, h.matchEnd);
        const after = h.preview.slice(h.matchEnd);
        return (
          <li key={`c-${i}`} onClick={() => onPick(h)}>
            <span className={s.resultPath}>
              <IconSearch size={12} stroke={1.5} style={{ verticalAlign: 'middle', marginRight: 4 }} />
              {h.path}:{h.line}
            </span>
            <code className={s.resultLine}>{before}<mark>{match}</mark>{after}</code>
          </li>
        );
      })}
      {truncated && (
        <li className={s.truncatedRow}>{t('files.searchTruncated')}</li>
      )}
    </ul>
  );
}
