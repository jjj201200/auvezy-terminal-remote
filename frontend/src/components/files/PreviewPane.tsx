import { type JSX } from 'react';
import type { FilePreviewKind } from 'auvezy-terminal-remote-shared';
import { TextPreview } from './TextPreview.js';
import { MarkdownPreview } from './MarkdownPreview.js';
import { ImagePreview } from './ImagePreview.js';
import { useT } from '../../i18n/i18n-context.js';
import { useUserConfig } from '../../hooks/useUserConfig.js';
import s from './FileBrowserSheet.module.scss';

export type PreviewTarget =
  | { kind: Extract<FilePreviewKind, 'text'>; path: string; name: string; jumpLine?: number }
  | { kind: Extract<FilePreviewKind, 'image'>; path: string; name: string; size: number }
  | { kind: Extract<FilePreviewKind, 'none'>; path: string; name: string; size: number };

export interface PreviewPaneProps {
  instanceId: string;
  target: PreviewTarget | null;
  wrapLines: boolean;
}

/** .md / .markdown 后缀(忽略大小写)— 仅在用户开启 markdownPreview 时走富文本渲染 */
function isMarkdownPath(p: string): boolean {
  const lower = p.toLowerCase();
  return lower.endsWith('.md') || lower.endsWith('.markdown');
}

export function PreviewPane({ instanceId, target, wrapLines }: PreviewPaneProps): JSX.Element {
  const t = useT();
  const { config } = useUserConfig();
  const mdEnabled = config.display?.markdownPreview === true;

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
      {target.kind === 'text' && mdEnabled && isMarkdownPath(target.path) ? (
        <MarkdownPreview instanceId={instanceId} path={target.path} />
      ) : target.kind === 'text' && (
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
