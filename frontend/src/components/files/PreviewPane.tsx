import { lazy, Suspense, type JSX } from 'react';
import type { FilePreviewKind } from 'auvezy-terminal-remote-shared';
import { TextPreview } from './TextPreview.js';
import { ImagePreview } from './ImagePreview.js';
import { MediaPreview } from './MediaPreview.js';
import { useT } from '../../i18n/i18n-context.js';
import { useUserConfig } from '../../hooks/useUserConfig.js';
import { BrailleSpinner } from '../ui/BrailleSpinner.js';
import { isMarkdownPath, isHtmlPath } from './file-kind.js';
import s from './FileBrowserSheet.module.scss';

// MarkdownPreview 含 react-markdown + remark/rehype 全套 + katex CSS,
// 整体 ~250KB gzipped。未启用 markdownPreview 的用户不应付这份代价
const MarkdownPreview = lazy(() =>
  import('./MarkdownPreview.js').then((m) => ({ default: m.MarkdownPreview })),
);

// HtmlPreview 仅 .html 渲染模式按需加载(iframe srcdoc)
const HtmlPreview = lazy(() =>
  import('./HtmlPreview.js').then((m) => ({ default: m.HtmlPreview })),
);

/** 预览视图模式:rendered = md/html 富渲染;source = 走 TextPreview 看源码 */
export type PreviewViewMode = 'rendered' | 'source';

export type PreviewTarget =
  | { kind: Extract<FilePreviewKind, 'text'>; path: string; name: string; jumpLine?: number }
  | { kind: Extract<FilePreviewKind, 'image'>; path: string; name: string; size: number }
  | { kind: Extract<FilePreviewKind, 'video'>; path: string; name: string; size: number }
  | { kind: Extract<FilePreviewKind, 'audio'>; path: string; name: string; size: number }
  | { kind: Extract<FilePreviewKind, 'none'>; path: string; name: string; size: number };

export interface PreviewPaneProps {
  instanceId: string;
  target: PreviewTarget | null;
  wrapLines: boolean;
  /** 透传至 MarkdownPreview,触发 bringToTop 后重新跳 anchor。见 FilePreviewSheet 注释 */
  activationSeq?: number;
  /**
   * 视图模式。md/html 文件在 rendered(默认)走富渲染,source 走 TextPreview 看源码;
   * 其它 text 文件该值无意义(始终 TextPreview)。由 FilePreviewSheet 的切换按钮控制。
   */
  viewMode?: PreviewViewMode;
}

export function PreviewPane({
  instanceId,
  target,
  wrapLines,
  activationSeq,
  viewMode = 'rendered',
}: PreviewPaneProps): JSX.Element {
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
  // rendered 模式下 md/html 走富渲染;source 模式或其它 text 文件走 TextPreview。
  const rendered = viewMode === 'rendered';
  const showMarkdown = target.kind === 'text' && rendered && mdEnabled && isMarkdownPath(target.path);
  const showHtml = target.kind === 'text' && rendered && isHtmlPath(target.path);

  const suspenseFallback = (
    <div className={`${s.notice} ${s.previewLoadingFallback} fb-preview__notice`}>
      <BrailleSpinner size="lg" label={t('files.previewLoading')} />
    </div>
  );

  return (
    <div
      id="file-browser-preview"
      className={`${s.preview} fb-preview fb-preview--${target.kind}`}
      data-kind={target.kind}
      data-path={target.path}
    >
      {showMarkdown ? (
        <Suspense fallback={suspenseFallback}>
          <MarkdownPreview instanceId={instanceId} path={target.path} activationSeq={activationSeq} />
        </Suspense>
      ) : showHtml ? (
        <Suspense fallback={suspenseFallback}>
          <HtmlPreview instanceId={instanceId} path={target.path} />
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
      {(target.kind === 'video' || target.kind === 'audio') && (
        <MediaPreview instanceId={instanceId} path={target.path} kind={target.kind} />
      )}
      {target.kind === 'none' && (
        <div className={`${s.unsupported} fb-preview__unsupported`}>
          {t('files.previewBinary')}
        </div>
      )}
    </div>
  );
}
