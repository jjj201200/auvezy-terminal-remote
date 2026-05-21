import { useEffect, useRef, useState, type JSX } from 'react';
import { ErrorCode, type FileEntry, type SearchEvent } from 'auvezy-terminal-remote-shared';
import { Sheet } from '../ui/Sheet.js';
import { useT } from '../../i18n/i18n-context.js';
import { useFiles } from '../../hooks/useFiles.js';
import { streamSearch, type SearchHandle } from '../../services/files-api.js';
import { useFilePreviewPresenter } from '../ui/modal-stack/presenters.js';
import {
  loadFileBrowserPrefs,
  saveShowHidden,
} from '../../services/file-browser-prefs.js';
import { Breadcrumb } from './Breadcrumb.js';
import { FileList } from './FileList.js';
import type { PreviewTarget } from './PreviewPane.js';
import { SearchBox } from './SearchBox.js';
import { SearchResults } from './SearchResults.js';
import { translateFileErr } from './translate-err.js';
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
  const presentFilePreview = useFilePreviewPresenter();
  const [path, setPath] = useState<string | undefined>(undefined);
  const [cwd, setCwd] = useState<string>('');
  const [parent, setParent] = useState<string | null>(null);
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [showHidden, setShowHidden] = useState<boolean>(() => loadFileBrowserPrefs().showHidden);
  useEffect(() => { saveShowHidden(showHidden); }, [showHidden]);
  const [error, setError] = useState<string | null>(null);

  const [submittedQ, setSubmittedQ] = useState('');
  // SearchBox 自己维护 input draft,用 key 强制重挂载让父在 onPick / 切实例 / 重开
  // sheet 时把草稿一并清掉 —— 这是 React 里"用 key 重置子状态"的标准用法。
  const [searchBoxKey, setSearchBoxKey] = useState(0);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [regex, setRegex] = useState(false);
  const [hits, setHits] = useState<SearchEvent[]>([]);
  const [scanning, setScanning] = useState(false);
  const [searchTruncated, setSearchTruncated] = useState(false);
  const handleRef = useRef<SearchHandle | null>(null);

  useEffect(() => {
    if (!open) return;
    setPath(undefined);
    setSubmittedQ('');
    setSearchBoxKey((k) => k + 1);
  }, [open, instanceId]);

  // 搜索必须由用户显式 submit 触发(SEARCH_MIN_CHARS 闸 + 按钮触发),
  // 避免 keystroke 级请求穿透服务端限流。
  useEffect(() => {
    handleRef.current?.cancel();
    handleRef.current = null;

    if (!open || submittedQ.length < SEARCH_MIN_CHARS) {
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
      { q: submittedQ, mode: 'both', caseSensitive, regex },
      (m) => setHits((prev) => [...prev, m]),
      (d) => {
        setScanning(false);
        setSearchTruncated(d.truncated);
      },
      () => setScanning(false),
    );
    handleRef.current = h;
    return () => h.cancel();
  }, [open, submittedQ, caseSensitive, regex, instanceId]);

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
      if (!cancelled) setError(e.code ?? ErrorCode.INTERNAL_ERROR);
    });
    return () => { cancelled = true; };
    // t 不进 deps —— 错误状态只存 ErrorCode,渲染时再翻译,避免 t 引用每次 render
    // 微变化触发 effect 重跑。
  }, [open, path, instanceId, files]);

  const openPreview = (target: PreviewTarget): void => {
    presentFilePreview({ instanceId, target });
  };

  const onEntryClick = (e: FileEntry): void => {
    const base = path ?? cwd;
    const full = `${base}/${e.name}`;
    if (e.kind === 'dir') {
      setPath(full);
      return;
    }
    if (e.previewable === 'text') {
      openPreview({ kind: 'text', path: full, name: e.name });
    } else if (e.previewable === 'image') {
      openPreview({ kind: 'image', path: full, name: e.name, size: e.size });
    } else {
      openPreview({ kind: 'none', path: full, name: e.name, size: e.size });
    }
  };

  const visibleEntries = showHidden ? entries : entries.filter((e) => !e.hidden);
  const inSearchMode = submittedQ.length >= SEARCH_MIN_CHARS;

  const onPickHit = (h: SearchEvent): void => {
    if (h.kind === 'content') {
      openPreview({ kind: 'text', path: h.path, name: `${h.path}:${h.line}`, jumpLine: h.line });
    } else {
      openPreview({ kind: 'text', path: h.path, name: h.path });
    }
    setSubmittedQ('');
    setSearchBoxKey((k) => k + 1);
  };

  const clearSearch = (): void => {
    setSubmittedQ('');
    setSearchBoxKey((k) => k + 1);
  };

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={t('files.title')}
      className={s.sheet}
      id="file-browser-sheet"
    >
      <div className={`${s.root} fb-root`} data-instance-id={instanceId} data-cwd={cwd} data-path={path ?? cwd}>
        <Breadcrumb
          cwd={cwd}
          path={path ?? cwd}
          parent={parent}
          onJump={(p) => setPath(p)}
          showHidden={showHidden}
          onToggleHidden={() => setShowHidden((v) => !v)}
        />
        <SearchBox
          key={searchBoxKey}
          submittedQ={submittedQ}
          caseSensitive={caseSensitive}
          regex={regex}
          onSubmit={(q) => setSubmittedQ(q)}
          onClear={clearSearch}
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
        <div
          className={`${s.body} fb-body`}
          data-mode={inSearchMode ? 'search' : 'list'}
        >
          {inSearchMode ? (
            <SearchResults
              hits={hits}
              truncated={searchTruncated}
              onPick={onPickHit}
            />
          ) : (
            <FileList
              entries={visibleEntries}
              error={error ? translateFileErr(t, error) : null}
              onEntryClick={onEntryClick}
            />
          )}
        </div>
      </div>
    </Sheet>
  );
}
