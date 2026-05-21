/**
 * syntax-highlight:Shiki 包装 + 多重降级
 *
 * 调用规则:
 *  - 超过 maxBytes 的文本 → escapeHtml 直出(防主线程阻塞)
 *  - 未知 lang → escapeHtml 直出
 *  - Shiki 动态加载 / codeToHtml 抛任何异常 → escapeHtml 不抛
 *
 * 设计选择:用 Shiki 4.x 顶级 `codeToHtml(code, { lang, theme })`,内部已含
 * singleton highlighter + 按需 lazy load grammar/theme。不自己 cache highlighter,
 * 让 Shiki 自己管。
 */

import { toShikiLang } from './lang-map.js';

/**
 * 默认最大高亮字节数(1 MiB)。
 *
 * 这是个"安全兜底",真正的阈值由调用方传 maxBytes 决定。
 * 超过后走 escapeHtml(纯文本展示,不阻塞主线程)。
 */
export const DEFAULT_MAX_HIGHLIGHT_BYTES = 1024 * 1024;

export type SupportedTheme = 'github-dark' | 'github-light';

export interface HighlightOptions {
  /** 字节阈值;超过 → 走 escapeHtml 降级。默认 DEFAULT_MAX_HIGHLIGHT_BYTES */
  maxBytes?: number;
}

/**
 * 高亮一段代码,返回完整 HTML。失败 / 超大 / 未知 lang 一律降级。
 */
export async function highlight(
  code: string,
  backendLang: string,
  theme: SupportedTheme,
  opts: HighlightOptions = {},
): Promise<string> {
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_HIGHLIGHT_BYTES;
  if (code.length > maxBytes) {
    return wrapPre(escapeHtml(code));
  }
  const lang = toShikiLang(backendLang);
  if (lang === 'txt') {
    return wrapPre(escapeHtml(code));
  }
  try {
    const { codeToHtml } = await import('shiki');
    return await codeToHtml(code, { lang, theme });
  } catch {
    return wrapPre(escapeHtml(code));
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function wrapPre(escaped: string): string {
  return `<pre><code>${escaped}</code></pre>`;
}

/** 测试用导出 */
export const escapeHtmlForTest = escapeHtml;
