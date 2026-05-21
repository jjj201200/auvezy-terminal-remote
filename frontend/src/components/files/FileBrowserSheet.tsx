/**
 * FileBrowserSheet
 *
 * 文件浏览面板。复用 Sheet primitive,桌面两栏(300px+1fr),
 * 移动单栏栈(media query 自动切)。
 *
 * 阶段 5:基础列表 + 预览,无搜索无高亮(阶段 6/7 接入)。
 */

import { useEffect, useRef, useState, type JSX } from 'react';
import type { FileEntry, SearchEvent } from 'auvezy-terminal-remote-shared';
import { Sheet } from '../ui/Sheet.js';
import { useT } from '../../i18n/i18n-context.js';
import { useFiles } from '../../hooks/useFiles.js';
import { streamSearch, type SearchHandle } from '../../services/files-api.js';
import { Breadcrumb } from './Breadcrumb.js';
import { FileList } from './FileList.js';
import { PreviewPane, type PreviewTarget } from './PreviewPane.js';
import { SearchBox } from './SearchBox.js';
import { SearchResults } from './SearchResults.js';
import s from './FileBrowserSheet.module.scss';

const SEARCH_MIN_CHARS = 3;

export interface FileBrowserSheetProps {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  instanceId: string;
}

export function FileBrowserSheet({ open, onOpenChange, instanceId }: FileBrowserSheetProps): JSX.Element {
  const t = useT();
  const files = useFiles(instanceId);
  const [path, setPath] = useState<string | undefined>(undefined);
  const [cwd, setCwd] = useState<string>('');
  const [parent, setParent] = useState<string | null>(null);
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [showHidden, setShowHidden] = useState(false);
  const [preview, setPreview] = useState<PreviewTarget | null>(null);
  const [error, setError] = useState<string | null>(null);

  // ──────────── 搜索 state ────────────
  const [searchQ, setSearchQ] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [regex, setRegex] = useState(false);
  const [hits, setHits] = useState<SearchEvent[]>([]);
  const [scanning, setScanning] = useState(false);
  const [searchTruncated, setSearchTruncated] = useState(false);
  const handleRef = useRef<SearchHandle | null>(null);

  // 切实例 / 重开 sheet 时重置 path
  useEffect(() => {
    if (!open) return;
    setPath(undefined);
    setPreview(null);
    setSearchQ('');
  }, [open, instanceId]);

  // 搜索:>= 3 char 自动触发,关键字变 / sheet 关 → cancel 旧流
  useEffect(() => {
    handleRef.current?.cancel();
    handleRef.current = null;

    if (!open || searchQ.length < SEARCH_MIN_CHARS) {
      setHits([]);
      setScanning(false);
      setSearchTruncated(false);
      return;
    }

    setHits([]);
    setSearchTruncated(false);
    setScanning(true);
    const h = streamSearch(
      instanceId,
      { q: searchQ, mode: 'both', caseSensitive, regex },
      (m) => setHits((prev) => [...prev, m]),
      (d) => {
        setScanning(false);
        setSearchTruncated(d.truncated);
      },
      () => setScanning(false),
    );
    handleRef.current = h;
    return () => h.cancel();
  }, [open, searchQ, caseSensitive, regex, instanceId]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setError(null);
    files.list(path).then((r) => {
      if (cancelled) return;
      setCwd(r.cwd);
      setEntries(r.entries);
      setParent(r.parent);
      if (path !== r.path) setPath(r.path);
    }).catch((e: Error & { code?: string }) => {
      if (!cancelled) setError(e.code ?? 'UNKNOWN');
    });
    return () => { cancelled = true; };
    // 注:t 不进 deps —— 错误状态只存 ErrorCode,渲染时再翻译,
    // 避免 t 引用每次 render 微变化触发 effect 重跑;files 已通过
    // useMemo 稳定化,不会触发死循环。
  }, [open, path, instanceId, files]);

  const onEntryClick = (e: FileEntry): void => {
    const base = path ?? cwd;
    const full = `${base}/${e.name}`;
    if (e.kind === 'dir') {
      setPath(full);
      return;
    }
    if (e.previewable === 'text') {
      setPreview({ kind: 'text', path: full, name: e.name });
    } else if (e.previewable === 'image') {
      setPreview({ kind: 'image', path: full, name: e.name, size: e.size });
    } else {
      setPreview({ kind: 'none', path: full, name: e.name, size: e.size });
    }
  };

  const visibleEntries = showHidden ? entries : entries.filter((e) => !e.hidden);
  const inSearchMode = searchQ.length >= SEARCH_MIN_CHARS;

  const onPickHit = (h: SearchEvent): void => {
    // name 与 content 命中都按 text 预览打开(精准行跳转不在 MVP 范围)
    const name = h.kind === 'content' ? `${h.path}:${h.line}` : h.path;
    setPreview({ kind: 'text', path: h.path, name });
    setSearchQ('');
  };

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={t('files.title')}
      className={s.sheet}
      id="file-browser-sheet"
    >
      <div className={s.root}>
        <Breadcrumb
          cwd={cwd}
          path={path ?? cwd}
          parent={parent}
          onJump={(p) => setPath(p)}
          showHidden={showHidden}
          onToggleHidden={() => setShowHidden((v) => !v)}
        />
        <SearchBox
          value={searchQ}
          caseSensitive={caseSensitive}
          regex={regex}
          onChange={setSearchQ}
          onToggleCase={() => setCaseSensitive((v) => !v)}
          onToggleRegex={() => setRegex((v) => !v)}
          onCancel={() => {
            handleRef.current?.cancel();
            setScanning(false);
          }}
          scanning={scanning}
          scanned={hits.length}
          hits={hits.length}
        />
        <div className={s.body}>
          {inSearchMode ? (
            <SearchResults
              hits={hits}
              truncated={searchTruncated}
              onPick={onPickHit}
            />
          ) : (
            <FileList
              entries={visibleEntries}
              error={error ? translateErr(t, error) : null}
              onEntryClick={onEntryClick}
            />
          )}
          <PreviewPane
            instanceId={instanceId}
            target={preview}
            onClose={() => setPreview(null)}
          />
        </div>
      </div>
    </Sheet>
  );
}

function translateErr(t: ReturnType<typeof useT>, code: string): string {
  switch (code) {
    case 'PATH_NOT_FOUND': return t('files.errorPathNotFound');
    case 'PATH_FORBIDDEN': return t('files.errorPathForbidden');
    case 'FILE_BINARY': return t('files.errorFileBinary');
    case 'AUTH_RATE_LIMITED': return t('files.errorRateLimited');
    default: return t('files.errorUnknown');
  }
}
