/**
 * TextPreview:文本文件预览 + Shiki 语法高亮
 *
 * 主题跟随用户在 Settings → 显示 中选择的终端主题 variant:
 *   - dark/dark-ansi/dark-daltonized → github-dark
 *   - light/light-ansi/light-daltonized → github-light
 *   - auto → 跟随 prefers-color-scheme
 * 超大文本(>200 KB)由 syntax-highlight 内部自动降级 escapeHtml。
 *
 * 安全:dangerouslySetInnerHTML 仅渲染 highlight() 输出。highlight() 内部
 * 所有非 Shiki 路径都走 escapeHtml,Shiki 自身输出是可信 HTML(无 XSS)。
 */

import { useEffect, useState, type JSX } from 'react';
import { useFiles } from '../../hooks/useFiles.js';
import { useT } from '../../i18n/i18n-context.js';
import { useUserConfig } from '../../hooks/useUserConfig.js';
import { resolveThemeVariant } from '../../themes/terminal-themes.js';
import { highlight, type SupportedTheme } from '../../utils/syntax-highlight.js';
import s from './FileBrowserSheet.module.scss';

export interface TextPreviewProps {
  instanceId: string;
  path: string;
}

const HIGHLIGHT_OFF_BYTES = 1024 * 1024;

export function TextPreview({ instanceId, path }: TextPreviewProps): JSX.Element {
  const t = useT();
  const files = useFiles(instanceId);
  const { config } = useUserConfig();
  const [html, setHtml] = useState<string>('');
  const [truncated, setTruncated] = useState(false);
  const [highlightOff, setHighlightOff] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Shiki 主题跟随用户显示设置,而非硬编 prefers-color-scheme
  const themeVariant = resolveThemeVariant(config.display?.theme);
  const theme: SupportedTheme = themeVariant === 'dark' ? 'github-dark' : 'github-light';

  useEffect(() => {
    let cancelled = false;
    setErr(null);
    setHtml('');
    setTruncated(false);
    setHighlightOff(false);

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
    // 切换主题(theme 变化)也需要重新跑 highlight → 加入 deps
  }, [path, files, theme]);

  if (err) {
    return (
      <div className={`${s.error} fb-preview__error`} role="alert">
        {translateErr(t, err)}
      </div>
    );
  }
  return (
    <>
      {truncated && (
        <div className={`${s.notice} fb-preview__notice fb-preview__notice--truncated`}>
          {t('files.previewTruncated')}
        </div>
      )}
      {highlightOff && (
        <div className={`${s.notice} fb-preview__notice fb-preview__notice--highlight-off`}>
          {t('files.previewHighlightOff')}
        </div>
      )}
      <div
        className={`${s.textPre} fb-preview__text`}
        data-truncated={truncated ? 'true' : 'false'}
        data-highlight-off={highlightOff ? 'true' : 'false'}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </>
  );
}

function translateErr(t: ReturnType<typeof useT>, code: string): string {
  switch (code) {
    case 'PATH_NOT_FOUND': return t('files.errorPathNotFound');
    case 'PATH_FORBIDDEN': return t('files.errorPathForbidden');
    case 'FILE_BINARY': return t('files.errorFileBinary');
    case 'AUTH_RATE_LIMITED': return t('files.errorRateLimited');
    default: return t('files.errorUnknown');
  }
}
