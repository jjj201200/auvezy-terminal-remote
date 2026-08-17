/**
 * FilePreviewSheet — 预览独立 modal(modal-stack 第二层),由 FileBrowserSheet 推出。
 * 桌面与移动均全屏,文件阅读需要尽可能大的容器。
 *
 * wrap toggle 提到 Sheet 标题栏 headerExtra slot,避免 body 内自画一条 header。
 */

import { useEffect, useState, type JSX } from 'react';
import { IconCircleX, IconCode, IconEye, IconStack2 } from '@tabler/icons-react';
import { Sheet } from '../ui/Sheet.js';
import { useT } from '../../i18n/i18n-context.js';
import { useUserConfig } from '../../hooks/useUserConfig.js';
import { useConfirm } from '../ui/ConfirmProvider.js';
import { PreviewPane, type PreviewTarget, type PreviewViewMode } from './PreviewPane.js';
import { isMarkdownPath, isHtmlPath } from './file-kind.js';
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
  /**
   * 重激活序号(可选)。两条 presenter(useFilePreviewPusher 与 useFilePreviewPresenter)
   * 都把 ctx.activatedSeq 透传过来:同一文件被多次操作触发 bringToTop 时,
   * 组件不卸载、不重 mount → 默认 useEffect 不会重跑。activationSeq 变化作为
   * 信号让 MarkdownPreview 重新触发 anchor scrollIntoView。
   */
  activationSeq?: number;
  /**
   * 渲染"全部关闭(预览)"按钮。仅 useFilePreviewPusher 在同一组深度 ≥ 2 时
   * 才传(用 ctx.groupSize >= 2 判断)。点击 = stack.popGroup('file-preview')。
   * 这里走二次确认(useConfirm),避免误触关掉一长串预览。
   */
  onCloseAll?: () => void;
  /**
   * 渲染"栈视图"按钮。同样仅在 groupSize >= 2 时给。点击 = pusher 推一个
   * 全屏的 PreviewStackView modal,展示当前所有 file-preview 卡片(Recent
   * Apps 风格),点卡 = bringToTop。
   */
  onShowStack?: () => void;
}

export function FilePreviewSheet({
  open,
  onOpenChange,
  instanceId,
  target,
  activationSeq,
  onCloseAll,
  onShowStack,
}: FilePreviewSheetProps): JSX.Element {
  const t = useT();
  const confirm = useConfirm();
  const { config } = useUserConfig();
  const [wrapLines, setWrapLines] = useState<boolean>(() => loadFileBrowserPrefs().wrapLines);
  useEffect(() => { saveWrapLines(wrapLines); }, [wrapLines]);

  // 视图模式:md/html 默认 rendered(富渲染),可切 source 看源码。不持久化 —
  // 每次打开预览都从 rendered 起步(用户确认的行为)。
  const [viewMode, setViewMode] = useState<PreviewViewMode>('rendered');
  // 切文件时复位到 rendered:同一 sheet 实例不重 mount,target 变了但 state 不会
  // 自动重置,显式跟随 path 复位,避免上一个文件切到 source 后下一个也是 source。
  useEffect(() => { setViewMode('rendered'); }, [target.path]);

  // 该文件是否支持「源码 / 渲染」切换:markdown(且开启)或 html。
  const mdEnabled = config.integrations?.rendering?.markdown?.enabled !== false;
  const isMarkdown = mdEnabled && target.kind === 'text' && isMarkdownPath(target.path);
  const isHtml = target.kind === 'text' && isHtmlPath(target.path);
  const toggleable = isMarkdown || isHtml;

  // 当前是否处于富渲染(toggleable 文件 + rendered 模式)。决定 wrap toggle 是否有意义。
  const isRendering = toggleable && viewMode === 'rendered';

  // 源码 / 渲染 切换按钮(单图标 toggle)。仅 toggleable 文件显示。
  // rendered 态 → IconCode(点击去看源码);source 态 → IconEye(点击回渲染)。
  const viewToggle = toggleable ? (
    <button
      type="button"
      className={`${s.iconAction} fb-preview__view-toggle`}
      onClick={() => setViewMode((m) => (m === 'rendered' ? 'source' : 'rendered'))}
      title={viewMode === 'rendered' ? t('files.previewViewSource') : t('files.previewViewRendered')}
      aria-label={viewMode === 'rendered' ? t('files.previewViewSource') : t('files.previewViewRendered')}
      data-action="files-toggle-view-mode"
      data-mode={viewMode}
    >
      {viewMode === 'rendered'
        ? <IconCode size={18} stroke={1.5} />
        : <IconEye size={18} stroke={1.5} />}
    </button>
  ) : undefined;

  // wrap toggle:富渲染(markdown/html)自带换行,无意义 → 仅在看源码时显示。
  const wrapToggle = target.kind === 'text' && !isRendering ? (
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

  // 栈视图(IconStack2)— 点开浮层显示所有 file-preview 卡片,Recent Apps 风格
  const stackBtn = onShowStack ? (
    <button
      type="button"
      className={`${s.iconAction} fb-preview__stack`}
      onClick={onShowStack}
      title={t('files.previewStackView')}
      aria-label={t('files.previewStackView')}
      data-action="files-preview-stack-view"
    >
      <IconStack2 size={18} stroke={1.5} />
    </button>
  ) : undefined;

  // "全部关闭"— danger tone 二次确认,避免误触一键关掉长链预览
  const closeAllBtn = onCloseAll ? (
    <button
      type="button"
      className={`${s.iconAction} ${s.iconActionDanger} fb-preview__close-all`}
      onClick={async () => {
        const ok = await confirm({
          title: t('files.previewCloseAllConfirmTitle'),
          message: t('files.previewCloseAllConfirmMsg'),
          tone: 'danger',
          confirmLabel: t('files.previewCloseAll'),
        });
        if (ok === true) onCloseAll();
      }}
      title={t('files.previewCloseAll')}
      aria-label={t('files.previewCloseAll')}
      data-action="files-preview-close-all"
    >
      <IconCircleX size={18} stroke={1.5} />
    </button>
  ) : undefined;

  const headerExtra = viewToggle || wrapToggle || stackBtn || closeAllBtn ? (
    <>
      {wrapToggle}
      {viewToggle}
      {stackBtn}
      {closeAllBtn}
    </>
  ) : undefined;

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={target.name || t('files.title')}
      className={s.previewSheet}
      id="file-preview-sheet"
      headerExtra={headerExtra}
      hideDragHandle
      hideBackdrop
      bodyFlush
    >
      <PreviewPane
        instanceId={instanceId}
        target={target}
        wrapLines={wrapLines}
        activationSeq={activationSeq}
        viewMode={viewMode}
      />
    </Sheet>
  );
}
