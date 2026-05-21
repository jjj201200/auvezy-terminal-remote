/**
 * PreviewPane:右侧预览容器。target=null 时显示 empty placeholder。
 */

import type { JSX } from 'react';
import { IconX } from '@tabler/icons-react';
import { TextPreview } from './TextPreview.js';
import { ImagePreview } from './ImagePreview.js';
import { useT } from '../../i18n/i18n-context.js';
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
        <strong className="fb-preview__name">{target.name}</strong>
        <button
          type="button"
          className={`${s.closeBtn} fb-preview__close`}
          data-action="files-preview-close"
          onClick={onClose}
          aria-label="close preview"
        >
          <IconX size={16} stroke={1.5} />
        </button>
      </header>
      {target.kind === 'text' && <TextPreview instanceId={instanceId} path={target.path} />}
      {target.kind === 'image' && <ImagePreview instanceId={instanceId} path={target.path} />}
      {target.kind === 'none' && (
        <div className={`${s.unsupported} fb-preview__unsupported`}>
          {t('files.previewBinary')}
        </div>
      )}
    </div>
  );
}
