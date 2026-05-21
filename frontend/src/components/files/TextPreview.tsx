/**
 * TextPreview — 文本预览 + Shiki 高亮 + 虚拟滚动。
 *
 * 主题跟随用户在 Settings → 显示 中选择的终端主题 variant:
 *   variant 决定容器底色与 token 选 light/dark(写到 data-color-scheme);
 *   colorScheme 决定走标准 (one-*) 还是色弱友好 (solarized/tokyo-night)。
 *
 * Why 虚拟滚动:大文件(几万行 minified、log)一把渲染所有 <span class="line">
 * 节点会让主线程在 DOM 创建阶段卡 1-3 秒。Virtuoso 只渲染可视区附近的行,
 * 高度由内容自适应(支持 wrap-true 动态高度)。
 *
 * 超过 HIGHLIGHT_OFF_BYTES (1 MiB) 由 syntax-highlight 降级 escapeHtml,
 * 并在 UI 提示"已禁用高亮"。
 *
 * Why dangerouslySetInnerHTML 安全:highlight() 内部所有非 Shiki 路径都走
 * escapeHtml,Shiki 自身输出可信 HTML(无 XSS)。
 */

import { useEffect, useRef, useState, type CSSProperties, type JSX } from 'react';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';
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
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const [content, setContent] = useState<string>('');
  const [lang, setLang] = useState<string>('txt');
  const [lines, setLines] = useState<string[]>([]);
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
  // Why 入口清 content/lines:切文件时旧 effect 只 cancel 不重置 state,新 effect 在
  // 网络回来前 React state 还是旧内容,highlight effect 会拿旧 content + 新 path 跑
  // 一次,屏幕短暂渲染旧文件。同步置空消除这个中间态。
  useEffect(() => {
    let cancelled = false;
    setErr(null);
    setContent('');
    setLang('txt');
    setLines([]);
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
      if (!cancelled) setLines(rendered);
    });
    return () => { cancelled = true; };
  }, [content, lang, colorScheme]);

  // 3) jumpLine:lines 准备好后让 Virtuoso 滚到目标行并触发渲染 → ItemContent
  //    内同步给 idx+1 === jumpLine 的行加 .atr-line-hl class。
  // Why 用 Virtuoso scrollToIndex 而非 scrollIntoView:虚拟列表里目标行可能根本
  // 没渲染过,DOM 里不存在节点 → 必须先告诉 Virtuoso "我要看 index N"。
  useEffect(() => {
    if (!jumpLine || lines.length === 0) return;
    // align:'center' 把目标行滚到视窗中央,跟之前 scrollIntoView 行为一致
    virtuosoRef.current?.scrollToIndex({ index: jumpLine - 1, align: 'center', behavior: 'auto' });
  }, [lines, jumpLine]);

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
        className={`${s.textPre} fb-preview__text`}
        data-truncated={truncated ? 'true' : 'false'}
        data-highlight-off={highlightOff ? 'true' : 'false'}
        data-color-scheme={themeVariant}
        data-wrap={wrapLines ? 'true' : 'false'}
        // 行号列宽固定为"最大行号位数 + 1ch 留白":虚拟列表里每行是独立 grid
        // container,grid max-content 只看本行 → 列宽随行号位数抖动。
        // 用 CSS var 统一传给所有 .line 的 grid-template-columns 第一列。
        style={{ '--atr-gutter-w': `${String(lines.length).length + 1}ch` } as CSSProperties}
      >
        {lines.length > 0 && (
          <Virtuoso
            ref={virtuosoRef}
            style={{ height: '100%' }}
            totalCount={lines.length}
            itemContent={(idx) => {
              const isJump = jumpLine !== undefined && idx + 1 === jumpLine;
              return (
                <div
                  className={isJump ? LINE_HL_CLASS : undefined}
                  dangerouslySetInnerHTML={{ __html: lines[idx]! }}
                />
              );
            }}
          />
        )}
      </div>
    </>
  );
}
