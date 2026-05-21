/**
 * PreviewPane:右侧预览容器。target=null 时显示 empty placeholder。
 *
 * 文件名右侧带"自动换行"toggle(仅 text 模式有意义);默认不换行,
 * 持久化到 localStorage(atr.fileBrowser.wrapLines)。
 */

import { useEffect, useState, type JSX } from 'react';
import { IconArrowLeft } from '@tabler/icons-react';
import { TextPreview } from './TextPreview.js';
import { ImagePreview } from './ImagePreview.js';
import { useT } from '../../i18n/i18n-context.js';
import {
  loadFileBrowserPrefs,
  saveWrapLines,
} from '../../services/file-browser-prefs.js';
import s from './FileBrowserSheet.module.scss';

export type PreviewTarget =
  | { kind: 'text'; path: string; name: string }
  | { kind: 'image'; path: string; name: string; size: number }
  | { kind: 'none'; path: string; name: string; size: number };

export interface PreviewPaneProps {
  instanceId: string;
  target: PreviewTarget | null;
  onClose: () => void;
}

export function PreviewPane({ instanceId, target, onClose }: PreviewPaneProps): JSX.Element {
  const t = useT();
  // 自动换行持久化:与 showHidden 同模式,init 从 localStorage 读,切时同步写
  const [wrapLines, setWrapLinesState] = useState<boolean>(() => loadFileBrowserPrefs().wrapLines);
  const toggleWrap = (): void => {
    setWrapLinesState((prev) => {
      const next = !prev;
      saveWrapLines(next);
      return next;
    });
  };

  // Esc 键关预览(全屏模式下用户期望)
  useEffect(() => {
    if (!target) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [target, onClose]);

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
      <header className="fb-preview__header">
        <button
          type="button"
          className={`${s.backBtn} fb-preview__back`}
          data-action="files-preview-close"
          onClick={onClose}
          aria-label={t('files.previewBack')}
          title={t('files.previewBack')}
        >
          <IconArrowLeft size={14} stroke={1.5} />
          <span>{t('files.previewBack')}</span>
        </button>
        <strong className="fb-preview__name" title={target.path}>{target.name}</strong>
        {target.kind === 'text' && (
          <label className={`${s.toggle} fb-preview__wrap-toggle`}>
            <input
              type="checkbox"
              checked={wrapLines}
              onChange={toggleWrap}
              data-action="files-toggle-wrap"
            />
            {t('files.previewWrap')}
          </label>
        )}
      </header>
      {target.kind === 'text' && (
        <TextPreview instanceId={instanceId} path={target.path} wrapLines={wrapLines} />
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
