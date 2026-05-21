/**
 * FilePreviewSheet — 预览独立 modal(modal-stack 第二层),由 FileBrowserSheet 推出。
 * 桌面与移动均全屏,文件阅读需要尽可能大的容器。
 */

import type { JSX } from 'react';
import { Sheet } from '../ui/Sheet.js';
import { useT } from '../../i18n/i18n-context.js';
import { PreviewPane, type PreviewTarget } from './PreviewPane.js';
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
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={target.name || t('files.title')}
      className={s.previewSheet}
      id="file-preview-sheet"
    >
      <PreviewPane
        instanceId={instanceId}
        target={target}
        onClose={() => onOpenChange(false)}
      />
    </Sheet>
  );
}
