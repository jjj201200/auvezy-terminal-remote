/**
 * FileBrowserSheet
 *
 * 文件浏览面板。复用 Sheet primitive,桌面两栏(300px+1fr),
 * 移动单栏栈(media query 自动切)。
 *
 * 阶段 5:基础列表 + 预览,无搜索无高亮(阶段 6/7 接入)。
 */

import { useEffect, useState, type JSX } from 'react';
import type { FileEntry } from 'auvezy-terminal-remote-shared';
import { Sheet } from '../ui/Sheet.js';
import { useT } from '../../i18n/i18n-context.js';
import { useFiles } from '../../hooks/useFiles.js';
import { Breadcrumb } from './Breadcrumb.js';
import { FileList } from './FileList.js';
import { PreviewPane, type PreviewTarget } from './PreviewPane.js';
import s from './FileBrowserSheet.module.scss';

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

  // 切实例 / 重开 sheet 时重置 path
  useEffect(() => {
    if (!open) return;
    setPath(undefined);
    setPreview(null);
  }, [open, instanceId]);

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
      if (!cancelled) setError(translateErr(t, e.code ?? 'UNKNOWN'));
    });
    return () => { cancelled = true; };
  }, [open, path, instanceId, files, t]);

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

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={t('files.title')}>
      <div className={s.root}>
        <Breadcrumb
          cwd={cwd}
          path={path ?? cwd}
          parent={parent}
          onJump={(p) => setPath(p)}
          showHidden={showHidden}
          onToggleHidden={() => setShowHidden((v) => !v)}
        />
        <div className={s.body}>
          <FileList
            entries={visibleEntries}
            error={error}
            onEntryClick={onEntryClick}
          />
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
    default: return t('files.errorUnknown');
  }
}
