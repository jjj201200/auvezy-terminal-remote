/**
 * FilePreviewSheet — 预览独立 modal(modal-stack 第二层),由 FileBrowserSheet 推出。
 * 桌面与移动均全屏,文件阅读需要尽可能大的容器。
 *
 * wrap toggle 提到 Sheet 标题栏 headerExtra slot,避免 body 内自画一条 header。
 */

import { useEffect, useState, type JSX } from 'react';
import { IconCircleX, IconStack2 } from '@tabler/icons-react';
import { Sheet } from '../ui/Sheet.js';
import { useT } from '../../i18n/i18n-context.js';
import { useUserConfig } from '../../hooks/useUserConfig.js';
import { useConfirm } from '../ui/ConfirmProvider.js';
import { PreviewPane, type PreviewTarget } from './PreviewPane.js';
import { isMarkdownPath } from './file-kind.js';
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

  // markdown 富文本预览自带换行,wrap toggle 在该模式下无意义 → 隐藏
  const mdEnabled = config.integrations?.rendering?.markdown?.enabled !== false;
  const isMarkdown = mdEnabled && target.kind === 'text' && isMarkdownPath(target.path);

  const wrapToggle = target.kind === 'text' && !isMarkdown ? (
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

  const headerExtra = wrapToggle || stackBtn || closeAllBtn ? (
    <>
      {wrapToggle}
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
    >
      <PreviewPane
        instanceId={instanceId}
        target={target}
        wrapLines={wrapLines}
        activationSeq={activationSeq}
      />
    </Sheet>
  );
}
