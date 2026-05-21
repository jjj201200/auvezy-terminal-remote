/**
 * FileList:目录条目 ul。500 条以下不上虚拟滚动(YAGNI)。
 */

import type { JSX } from 'react';
import type { FileEntry } from 'auvezy-terminal-remote-shared';
import { useT } from '../../i18n/i18n-context.js';
import { iconFor, formatBytes } from './file-kind.js';
import s from './FileBrowserSheet.module.scss';

export interface FileListProps {
  entries: FileEntry[];
  error: string | null;
  onEntryClick: (e: FileEntry) => void;
}

export function FileList({ entries, error, onEntryClick }: FileListProps): JSX.Element {
  const t = useT();
  if (error) {
    return <div className={`${s.error} fb-list__error`} role="alert">{error}</div>;
  }
  if (entries.length === 0) {
    return <div className={`${s.empty} fb-list__empty`}>{t('files.empty')}</div>;
  }
  return (
    <ul id="file-browser-list" className={`${s.list} fb-list`} role="list">
      {entries.map((e) => (
        <li
          key={e.name}
          className="fb-list__row"
          data-action="files-entry"
          data-name={e.name}
          data-kind={e.kind}
          data-hidden={e.hidden ? 'true' : 'false'}
          data-previewable={e.previewable ?? 'none'}
          onClick={() => onEntryClick(e)}
          tabIndex={0}
          onKeyDown={(ev) => {
            if (ev.key === 'Enter' || ev.key === ' ') {
              ev.preventDefault();
              onEntryClick(e);
            }
          }}
        >
          <span className={`${s.icon} fb-list__icon`} aria-hidden>{iconFor(e)}</span>
          <span className={`${s.name} ${e.hidden ? s.hidden : ''} fb-list__name`}>{e.name}</span>
          <span className={`${s.size} fb-list__size`}>{e.kind === 'dir' ? '' : formatBytes(e.size)}</span>
        </li>
      ))}
    </ul>
  );
}
