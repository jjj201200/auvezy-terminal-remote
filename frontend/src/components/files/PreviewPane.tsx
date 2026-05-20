/**
 * PreviewPane:右侧/二级 sheet 的预览容器,按 PreviewTarget.kind 派发到子组件。
 */

import type { JSX } from 'react';
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
  if (!target) return <div className={s.preview} />;
  return (
    <div className={s.preview}>
      <header>
        <strong>{target.name}</strong>
        <button type="button" onClick={onClose} aria-label="close preview">×</button>
      </header>
      {target.kind === 'text' && <TextPreview instanceId={instanceId} path={target.path} />}
      {target.kind === 'image' && <ImagePreview instanceId={instanceId} path={target.path} />}
      {target.kind === 'none' && <div className={s.unsupported}>{t('files.previewBinary')}</div>}
    </div>
  );
}
