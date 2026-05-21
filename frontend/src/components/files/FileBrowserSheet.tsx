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
  // showHidden 持久化:初值从 localStorage 读,切换时同步写
  const [showHidden, setShowHiddenState] = useState<boolean>(() => loadFileBrowserPrefs().showHidden);
  const setShowHidden = (next: boolean | ((prev: boolean) => boolean)): void => {
    setShowHiddenState((prev) => {
      const v = typeof next === 'function' ? next(prev) : next;
      saveShowHidden(v);
      return v;
    });
  };
  const [error, setError] = useState<string | null>(null);

  // ──────────── 搜索 state ────────────
  // submittedQ:已提交的查询(空字符串 = 未在搜索模式)
  // searchBoxKey:用作 SearchBox key,父主动清搜索时换 key 让 input 草稿重置
  const [submittedQ, setSubmittedQ] = useState('');
  const [searchBoxKey, setSearchBoxKey] = useState(0);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [regex, setRegex] = useState(false);
  const [hits, setHits] = useState<SearchEvent[]>([]);
  const [scanning, setScanning] = useState(false);
  const [searchTruncated, setSearchTruncated] = useState(false);
  const handleRef = useRef<SearchHandle | null>(null);

  // 切实例 / 重开 sheet 时重置 path + 清搜索
  useEffect(() => {
    if (!open) return;
    setPath(undefined);
    setSubmittedQ('');
    setSearchBoxKey((k) => k + 1);
  }, [open, instanceId]);

  // 搜索:只在 submittedQ / toggle 变化时触发(不再听 input draft)
  // submittedQ 必须 >= SEARCH_MIN_CHARS 才发请求 — 这是用户显式按下"搜索"
  // 才触发的服务端调用,不会因敲键无限刷
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
      if (!cancelled) setError(e.code ?? 'UNKNOWN');
    });
    return () => { cancelled = true; };
    // 注:t 不进 deps —— 错误状态只存 ErrorCode,渲染时再翻译,
    // 避免 t 引用每次 render 微变化触发 effect 重跑;files 已通过
    // useMemo 稳定化,不会触发死循环。
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
    // name 与 content 命中都按 text 预览打开(精准行跳转不在 MVP 范围)
    const name = h.kind === 'content' ? `${h.path}:${h.line}` : h.path;
    openPreview({ kind: 'text', path: h.path, name });
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
              error={error ? translateErr(t, error) : null}
              onEntryClick={onEntryClick}
            />
          )}
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
