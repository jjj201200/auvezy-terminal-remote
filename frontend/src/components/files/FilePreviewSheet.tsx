/**
 * FilePreviewSheet — 预览独立 modal(modal-stack 第二层),由 FileBrowserSheet 推出。
 * 桌面与移动均全屏,文件阅读需要尽可能大的容器。
 *
 * wrap toggle 提到 Sheet 标题栏 headerExtra slot,避免 body 内自画一条 header。
 */

import { useEffect, useState, type JSX } from 'react';
import { Sheet } from '../ui/Sheet.js';
import { useT } from '../../i18n/i18n-context.js';
import { PreviewPane, type PreviewTarget } from './PreviewPane.js';
import {
  loadFileBrowserPrefs,
  saveWrapLines,
} from '../../services/file-browser-prefs.js';
import s from './FileBrowserSheet.module.scss';

export interface FilePreviewSheetProps {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  instanceId: string;
  target: PreviewTarget;
}

export function FilePreviewSheet({
  open,
  onOpenChange,
  instanceId,
  target,
}: FilePreviewSheetProps): JSX.Element {
  const t = useT();
  const [wrapLines, setWrapLines] = useState<boolean>(() => loadFileBrowserPrefs().wrapLines);
  useEffect(() => { saveWrapLines(wrapLines); }, [wrapLines]);

  const wrapToggle = target.kind === 'text' ? (
    <label className={`${s.toggle} fb-preview__wrap-toggle`}>
      <input
        type="checkbox"
        checked={wrapLines}
        onChange={() => setWrapLines((v) => !v)}
        data-action="files-toggle-wrap"
      />
      {t('files.previewWrap')}
    </label>
  ) : undefined;

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={target.name || t('files.title')}
      className={s.previewSheet}
      id="file-preview-sheet"
      headerExtra={wrapToggle}
    >
      <PreviewPane instanceId={instanceId} target={target} wrapLines={wrapLines} />
    </Sheet>
  );
}
