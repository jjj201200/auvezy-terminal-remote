/**
 * ImagePreview:用 broker `/api/files/raw` 直接给 <img>,
 * 失败(X-ATR-Error)走 onError 占位。
 */

import { useState, type JSX } from 'react';
import { rawUrl } from '../../services/files-api.js';
import { useT } from '../../i18n/i18n-context.js';
import s from './FileBrowserSheet.module.scss';

export interface ImagePreviewProps {
  instanceId: string;
  path: string;
}

export function ImagePreview({ instanceId, path }: ImagePreviewProps): JSX.Element {
  const t = useT();
  const [failed, setFailed] = useState(false);
  if (failed) return <div className={s.unsupported}>{t('files.previewBinary')}</div>;
  return (
    <img
      className={s.image}
      src={rawUrl(instanceId, path)}
      onError={() => setFailed(true)}
      alt={path}
    />
  );
}
