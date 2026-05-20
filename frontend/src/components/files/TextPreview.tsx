/**
 * TextPreview:文本文件预览 + Shiki 语法高亮
 *
 * 主题跟随浏览器 prefers-color-scheme。
 * 超大文本(>200 KB)由 syntax-highlight 内部自动降级 escapeHtml。
 *
 * 安全:dangerouslySetInnerHTML 仅渲染 highlight() 输出。highlight() 内部
 * 所有非 Shiki 路径都走 escapeHtml,Shiki 自身输出是可信 HTML(无 XSS)。
 */

import { useEffect, useState, type JSX } from 'react';
import { useFiles } from '../../hooks/useFiles.js';
import { useT } from '../../i18n/i18n-context.js';
import { highlight, type SupportedTheme } from '../../utils/syntax-highlight.js';
import s from './FileBrowserSheet.module.scss';

export interface TextPreviewProps {
  instanceId: string;
  path: string;
}

const HIGHLIGHT_OFF_BYTES = 200 * 1024;

export function TextPreview({ instanceId, path }: TextPreviewProps): JSX.Element {
  const t = useT();
  const files = useFiles(instanceId);
  const [html, setHtml] = useState<string>('');
  const [truncated, setTruncated] = useState(false);
  const [highlightOff, setHighlightOff] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setErr(null);
    setHtml('');
    setTruncated(false);
    setHighlightOff(false);

    const theme: SupportedTheme = typeof matchMedia === 'function'
      && matchMedia('(prefers-color-scheme: dark)').matches
        ? 'github-dark'
        : 'github-light';

    files.read(path)
      .then(async (r) => {
        if (cancelled) return;
        setTruncated(r.truncated);
        setHighlightOff(r.content.length > HIGHLIGHT_OFF_BYTES);
        const rendered = await highlight(r.content, r.lang, theme);
        if (!cancelled) setHtml(rendered);
      })
      .catch((e: Error & { code?: string }) => {
        if (!cancelled) setErr(e.code ?? 'UNKNOWN');
      });

    return () => { cancelled = true; };
  }, [path, files]);

  if (err) return <div className={s.error}>{translateErr(t, err)}</div>;
  return (
    <>
      {truncated && <div className={s.notice}>{t('files.previewTruncated')}</div>}
      {highlightOff && <div className={s.notice}>{t('files.previewHighlightOff')}</div>}
      <div className={s.textPre} dangerouslySetInnerHTML={{ __html: html }} />
    </>
  );
}

function translateErr(t: ReturnType<typeof useT>, code: string): string {
  switch (code) {
    case 'PATH_NOT_FOUND': return t('files.errorPathNotFound');
    case 'PATH_FORBIDDEN': return t('files.errorPathForbidden');
    case 'FILE_BINARY': return t('files.errorFileBinary');
    default: return t('files.errorUnknown');
  }
}
