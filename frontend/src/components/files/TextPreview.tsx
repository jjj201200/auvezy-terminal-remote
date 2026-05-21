/**
 * TextPreview — 文本预览 + Shiki 高亮。
 *
 * 主题跟随用户在 Settings → 显示 中选择的终端主题 variant:
 *   variant 决定容器底色与 token 选 light/dark(写到 data-color-scheme);
 *   colorScheme 决定走标准 (one-*) 还是色弱友好 (solarized/tokyo-night)。
 * 超过 HIGHLIGHT_OFF_BYTES (1 MiB) 由 syntax-highlight 降级 escapeHtml,
 * 并在 UI 提示"已禁用高亮"。
 *
 * Why dangerouslySetInnerHTML 安全:highlight() 内部所有非 Shiki 路径都走
 * escapeHtml,Shiki 自身输出可信 HTML(无 XSS)。
 */

import { useEffect, useRef, useState, type JSX } from 'react';
import { useFiles } from '../../hooks/useFiles.js';
import { useT } from '../../i18n/i18n-context.js';
import { useUserConfig } from '../../hooks/useUserConfig.js';
import { resolveThemeVariant } from '../../themes/terminal-themes.js';
import { highlight } from '../../utils/syntax-highlight.js';
import { translateFileErr } from './translate-err.js';
import s from './FileBrowserSheet.module.scss';

export interface TextPreviewProps {
  instanceId: string;
  path: string;
  wrapLines?: boolean;
  /** 1-based 行号:渲染完成后滚动到该行并加 .atr-line-hl 高亮 */
  jumpLine?: number;
}

const HIGHLIGHT_OFF_BYTES = 1024 * 1024;
// 必须与 FileBrowserSheet.module.scss 内 :global(.atr-line-hl) 字面量一致
// (Shiki / 降级路径输出都不走 CSS Modules,行号样式 + 高亮 class 必须 :global)
const LINE_HL_CLASS = 'atr-line-hl';

export function TextPreview({
  instanceId,
  path,
  wrapLines = false,
  jumpLine,
}: TextPreviewProps): JSX.Element {
  const t = useT();
  const files = useFiles(instanceId);
  const { config } = useUserConfig();
  const containerRef = useRef<HTMLDivElement>(null);
  const [content, setContent] = useState<string>('');
  const [lang, setLang] = useState<string>('txt');
  const [html, setHtml] = useState<string>('');
  const [truncated, setTruncated] = useState(false);
  const [highlightOff, setHighlightOff] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const themeName = config.display?.theme;
  const themeVariant = resolveThemeVariant(themeName);
  const colorScheme: 'standard' | 'daltonized' =
    themeName === 'dark-daltonized' || themeName === 'light-daltonized'
      ? 'daltonized'
      : 'standard';

  // 1) 拉文件内容 —— 只在 path / files 变化时跑,主题切换不重 fetch。
  // Why 入口清 content/html:切文件时旧 effect 只 cancel 不重置 state,新 effect 在
  // 网络回来前 React state 还是旧内容,highlight effect 会拿旧 content + 新 path 跑
  // 一次,屏幕短暂渲染旧文件。同步置空消除这个中间态。
  useEffect(() => {
    let cancelled = false;
    setErr(null);
    setContent('');
    setLang('txt');
    setHtml('');
    setTruncated(false);
    setHighlightOff(false);

    files.read(path)
      .then((r) => {
        if (cancelled) return;
        setContent(r.content);
        setLang(r.lang);
        setTruncated(r.truncated);
        setHighlightOff(r.content.length > HIGHLIGHT_OFF_BYTES);
      })
      .catch((e: Error & { code?: string }) => {
        if (!cancelled) setErr(e.code ?? 'UNKNOWN');
      });

    return () => { cancelled = true; };
  }, [path, files]);

  // 2) 仅高亮 —— content/lang/colorScheme 变化时重跑,内容不变只切主题不闪空白。
  useEffect(() => {
    if (!content) return;
    let cancelled = false;
    highlight(content, lang, {
      maxBytes: HIGHLIGHT_OFF_BYTES,
      colorScheme,
    }).then((rendered) => {
      if (!cancelled) setHtml(rendered);
    });
    return () => { cancelled = true; };
  }, [content, lang, colorScheme]);

  // 3) 渲染完成后滚动到 jumpLine + 加高亮 class。
  // Why 单独 effect:依赖 html(确保 dangerouslySetInnerHTML 已落盘)与 jumpLine,
  // 任一变化都重跑(同一文件不同行也要重定位)。
  useEffect(() => {
    if (!jumpLine || !html) return;
    const root = containerRef.current;
    if (!root) return;
    const target = root.querySelector<HTMLElement>(`[data-line="${jumpLine}"]`);
    if (!target) return;
    target.classList.add(LINE_HL_CLASS);
    target.scrollIntoView({ block: 'center', behavior: 'auto' });
    return () => {
      target.classList.remove(LINE_HL_CLASS);
    };
  }, [html, jumpLine]);

  if (err) {
    return (
      <div className={`${s.error} fb-preview__error`} role="alert">
        {translateFileErr(t, err)}
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
        ref={containerRef}
        className={`${s.textPre} fb-preview__text`}
        data-truncated={truncated ? 'true' : 'false'}
        data-highlight-off={highlightOff ? 'true' : 'false'}
        data-color-scheme={themeVariant}
        data-wrap={wrapLines ? 'true' : 'false'}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </>
  );
}
