import { lazy, Suspense, type JSX } from 'react';
import type { FilePreviewKind } from 'auvezy-terminal-remote-shared';
import { TextPreview } from './TextPreview.js';
import { ImagePreview } from './ImagePreview.js';
import { useT } from '../../i18n/i18n-context.js';
import { useUserConfig } from '../../hooks/useUserConfig.js';
import { BrailleSpinner } from '../ui/BrailleSpinner.js';
import { isMarkdownPath } from './file-kind.js';
import s from './FileBrowserSheet.module.scss';

// MarkdownPreview 含 react-markdown + remark/rehype 全套 + katex CSS,
// 整体 ~250KB gzipped。未启用 markdownPreview 的用户不应付这份代价
const MarkdownPreview = lazy(() =>
  import('./MarkdownPreview.js').then((m) => ({ default: m.MarkdownPreview })),
);

export type PreviewTarget =
  | { kind: Extract<FilePreviewKind, 'text'>; path: string; name: string; jumpLine?: number }
  | { kind: Extract<FilePreviewKind, 'image'>; path: string; name: string; size: number }
  | { kind: Extract<FilePreviewKind, 'none'>; path: string; name: string; size: number };

export interface PreviewPaneProps {
  instanceId: string;
  target: PreviewTarget | null;
  wrapLines: boolean;
  /** 透传至 MarkdownPreview,触发 bringToTop 后重新跳 anchor。见 FilePreviewSheet 注释 */
  activationSeq?: number;
}

export function PreviewPane({ instanceId, target, wrapLines, activationSeq }: PreviewPaneProps): JSX.Element {
  const t = useT();
  const { config } = useUserConfig();
  // rendering.markdown.enabled 是新位置;ensureDefaultUserConfig 已把旧
  // display.markdownPreview 迁移过来。默认开启(undefined 视同 enabled)。
  const mdEnabled = config.integrations?.rendering?.markdown?.enabled !== false;

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
        <Suspense
          fallback={
            <div className={`${s.notice} ${s.previewLoadingFallback} fb-preview__notice`}>
              <BrailleSpinner size="lg" label={t('files.previewLoading')} />
            </div>
          }
        >
          <MarkdownPreview instanceId={instanceId} path={target.path} activationSeq={activationSeq} />
        </Suspense>
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
