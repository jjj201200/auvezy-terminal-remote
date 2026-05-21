import { useEffect, useState, type JSX } from 'react';
import type { FilePreviewKind } from 'auvezy-terminal-remote-shared';
import { TextPreview } from './TextPreview.js';
import { ImagePreview } from './ImagePreview.js';
import { useT } from '../../i18n/i18n-context.js';
import {
  loadFileBrowserPrefs,
  saveWrapLines,
} from '../../services/file-browser-prefs.js';
import s from './FileBrowserSheet.module.scss';

export type PreviewTarget =
  | { kind: Extract<FilePreviewKind, 'text'>; path: string; name: string; jumpLine?: number }
  | { kind: Extract<FilePreviewKind, 'image'>; path: string; name: string; size: number }
  | { kind: Extract<FilePreviewKind, 'none'>; path: string; name: string; size: number };

export interface PreviewPaneProps {
  instanceId: string;
  target: PreviewTarget | null;
}

export function PreviewPane({ instanceId, target }: PreviewPaneProps): JSX.Element {
  const t = useT();
  const [wrapLines, setWrapLines] = useState<boolean>(() => loadFileBrowserPrefs().wrapLines);
  useEffect(() => { saveWrapLines(wrapLines); }, [wrapLines]);

  if (!target) {
    return (
      <div
        id="file-browser-preview"
        className={`${s.preview} ${s.empty} fb-preview fb-preview--empty`}
        data-kind="empty"
      >
        {t('files.empty')}
      </div>
    );
  }
  return (
    <div
      id="file-browser-preview"
      className={`${s.preview} fb-preview fb-preview--${target.kind}`}
      data-kind={target.kind}
      data-path={target.path}
    >
      {target.kind === 'text' && (
        <header className="fb-preview__header">
          <label className={`${s.toggle} fb-preview__wrap-toggle`}>
            <input
              type="checkbox"
              checked={wrapLines}
              onChange={() => setWrapLines((v) => !v)}
              data-action="files-toggle-wrap"
            />
            {t('files.previewWrap')}
          </label>
        </header>
      )}
      {target.kind === 'text' && (
        <TextPreview
          instanceId={instanceId}
          path={target.path}
          wrapLines={wrapLines}
          jumpLine={target.jumpLine}
        />
      )}
      {target.kind === 'image' && <ImagePreview instanceId={instanceId} path={target.path} />}
      {target.kind === 'none' && (
        <div className={`${s.unsupported} fb-preview__unsupported`}>
          {t('files.previewBinary')}
        </div>
      )}
    </div>
  );
}
