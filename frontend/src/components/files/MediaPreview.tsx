/**
 * MediaPreview — <video> / <audio> 共用的预览组件。
 *
 * 浏览器原生 controls + 自动 Range 分片(worker 端 /files/raw 配 ETag/206/416)
 * → 拖进度条 / seek / 缓存命中秒回 304 都走原生路径,组件这层只管 UX:
 *
 *  - status='loading' 时叠 spinner 浮层
 *  - status='ready' 隐藏 spinner
 *  - status='failed' 显示二进制兜底文案
 *
 * Why 不再分两个组件:VideoPreview / AudioPreview 95% 重复,差异点(标签 /
 * 包裹类 / spinner size / 失败 data-reason)用 kind 一参即决。
 */

import { useState, type JSX } from 'react';
import { rawUrl } from '../../services/files-api.js';
import { useT } from '../../i18n/i18n-context.js';
import { BrailleSpinner } from '../ui/BrailleSpinner.js';
import s from './FileBrowserSheet.module.scss';

export type MediaKind = 'video' | 'audio';

export interface MediaPreviewProps {
  instanceId: string;
  path: string;
  kind: MediaKind;
}

type MediaStatus = 'loading' | 'ready' | 'failed';

export function MediaPreview({ instanceId, path, kind }: MediaPreviewProps): JSX.Element {
  const t = useT();
  const [status, setStatus] = useState<MediaStatus>('loading');

  if (status === 'failed') {
    return (
      <div
        className={`${s.unsupported} fb-preview__unsupported`}
        role="alert"
        data-reason={`${kind}-load-failed`}
      >
        {t('files.previewBinary')}
      </div>
    );
  }

  const wrapClass = kind === 'video' ? s.mediaWrap : s.audioWrap;
  const wrapDataClass = kind === 'video' ? 'fb-preview__media-wrap' : 'fb-preview__audio-wrap';
  const elementClass = kind === 'video' ? s.media : s.audio;
  const elementDataClass = kind === 'video' ? 'fb-preview__video' : 'fb-preview__audio';
  const spinnerSize = kind === 'video' ? 'lg' : 'md';

  const commonProps = {
    className: `${elementClass} ${elementDataClass}`,
    'data-path': path,
    src: rawUrl(instanceId, path),
    controls: true,
    preload: 'auto' as const,
    onCanPlay: () => setStatus('ready'),
    onError: () => setStatus('failed'),
  };

  return (
    <div className={`${wrapClass} ${wrapDataClass}`} data-path={path}>
      {kind === 'video' ? <video {...commonProps} /> : <audio {...commonProps} />}
      {status === 'loading' && (
        <div
          className={`${s.mediaLoading} fb-preview__media-loading`}
          role="status"
          aria-live="polite"
        >
          <BrailleSpinner size={spinnerSize} label={t('files.previewLoading')} />
        </div>
      )}
    </div>
  );
}
