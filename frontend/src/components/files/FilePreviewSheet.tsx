/**
 * FilePreviewSheet
 *
 * 文件预览独立 modal(modal-stack 第二层),从 FileBrowserSheet 推出。
 * 桌面与移动均"全屏 / 接近全屏",避免文件内容挤在小卡片里。
 *
 * 包了一层 Sheet primitive 让它走与 ShareSheet / FileBrowserSheet 同款的
 * Dialog(桌面)/ Drawer(移动)动画;PreviewPane 内部负责实际渲染。
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
      <div className={`${s.previewRoot} fb-preview-sheet-root`}>
        <PreviewPane
          instanceId={instanceId}
          target={target}
          onClose={() => onOpenChange(false)}
        />
      </div>
    </Sheet>
  );
}
