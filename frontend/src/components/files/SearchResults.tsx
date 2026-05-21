/**
 * SearchResults:搜索命中列表(name + content 分组,content 高亮命中区间)。
 */

import { useMemo, type JSX } from 'react';
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
    return (
      <div
        id="file-browser-search-results"
        className={`${s.empty} fb-search-results fb-search-results--empty`}
      >
        {t('files.searchEmpty')}
      </div>
    );
  }
  // 流式 SSE 每次 push 都会 re-render —— 用 useMemo 单次 partition,
  // 避免每帧跑两次 O(n) filter 退化成 O(n²)。
  const { nameHits, contentHits } = useMemo(() => {
    const nh: Extract<SearchEvent, { kind: 'name' }>[] = [];
    const ch: Extract<SearchEvent, { kind: 'content' }>[] = [];
    for (const h of hits) {
      if (h.kind === 'name') nh.push(h);
      else ch.push(h);
    }
    return { nameHits: nh, contentHits: ch };
  }, [hits]);
  return (
    <ul
      id="file-browser-search-results"
      className={`${s.searchList} fb-search-results`}
      role="list"
      data-truncated={truncated ? 'true' : 'false'}
    >
      {nameHits.map((h, i) => (
        <li
          key={`n-${i}`}
          className="fb-search-results__hit fb-search-results__hit--name"
          data-action="files-search-hit"
          data-hit-kind="name"
          data-path={h.path}
          onClick={() => onPick(h)}
        >
          <span className={`${s.resultName} fb-search-results__name`}>
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
          <li
            key={`c-${i}`}
            className="fb-search-results__hit fb-search-results__hit--content"
            data-action="files-search-hit"
            data-hit-kind="content"
            data-path={h.path}
            data-line={h.line}
            onClick={() => onPick(h)}
          >
            <span className={`${s.resultPath} fb-search-results__path`}>
              <IconSearch size={12} stroke={1.5} style={{ verticalAlign: 'middle', marginRight: 4 }} />
              {h.path}:{h.line}
            </span>
            <code className={`${s.resultLine} fb-search-results__line`}>
              {before}
              <mark className="fb-search-results__mark">{match}</mark>
              {after}
            </code>
          </li>
        );
      })}
      {truncated && (
        <li className={`${s.truncatedRow} fb-search-results__truncated`}>
          {t('files.searchTruncated')}
        </li>
      )}
    </ul>
  );
}
