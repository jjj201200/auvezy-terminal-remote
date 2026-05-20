/**
 * syntax-highlight:Shiki 包装 + 多重降级
 *
 * 调用规则:
 *  - >200 KB 文本 → escapeHtml 直出(防主线程阻塞)
 *  - 未知 lang → escapeHtml 直出
 *  - Shiki 动态加载 / codeToHtml 抛任何异常 → escapeHtml 不抛
 *
 * 设计选择:用 Shiki 4.x 顶级 `codeToHtml(code, { lang, theme })`,内部已含
 * singleton highlighter + 按需 lazy load grammar/theme。不自己 cache highlighter,
 * 让 Shiki 自己管。
 */

import { toShikiLang } from './lang-map.js';

const MAX_HIGHLIGHT_BYTES = 200 * 1024;

export type SupportedTheme = 'github-dark' | 'github-light';

/**
 * 高亮一段代码,返回完整 HTML。失败 / 超大 / 未知 lang 一律降级。
 */
export async function highlight(
  code: string,
  backendLang: string,
  theme: SupportedTheme,
): Promise<string> {
  if (code.length > MAX_HIGHLIGHT_BYTES) {
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
