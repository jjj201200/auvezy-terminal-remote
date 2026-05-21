/**
 * Shiki 包装 + 多重降级。
 *
 * Why:
 *  - 主线程跑 Shiki 对超大文本会卡死 → maxBytes 闸 → escapeHtml
 *  - 未知 lang 时 codeToHtml 会抛 → 提前 escapeHtml 兜底
 *  - 用 multi-themes + defaultColor:false 让 Shiki 输出 CSS 变量
 *    (--shiki-light / --shiki-dark);容器选哪套由 data-color-scheme 决定,
 *    底色由项目 design token 接管而不是 Shiki 内联色。
 */

import type { ShikiTransformer } from 'shiki';
import { toShikiLang } from './lang-map.js';

export const DEFAULT_MAX_HIGHLIGHT_BYTES = 1024 * 1024;

export type ColorScheme = 'standard' | 'daltonized';

export interface HighlightOptions {
  maxBytes?: number;
  colorScheme?: ColorScheme;
}

const THEME_PAIRS: Record<ColorScheme, { light: string; dark: string }> = {
  standard: { light: 'one-light', dark: 'one-dark-pro' },
  daltonized: { light: 'solarized-light', dark: 'tokyo-night' },
};

/**
 * 给每行 <span class="line"> 加 data-line + 行号 gutter。
 *
 * Why 两件事合并:gutter 必须在行内做,顺手把 data-line 加上;否则后续行高亮
 * 还要再写一个 transformer 重复同样的循环。
 */
const transformerLineMeta: ShikiTransformer = {
  name: 'atr:line-meta',
  line(node, line) {
    node.properties['data-line'] = String(line);
    node.children.unshift({
      type: 'element',
      tagName: 'span',
      properties: { class: 'shiki-line-number', 'aria-hidden': 'true' },
      children: [{ type: 'text', value: String(line) }],
    });
  },
};

export async function highlight(
  code: string,
  backendLang: string,
  opts: HighlightOptions = {},
): Promise<string> {
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_HIGHLIGHT_BYTES;
  if (code.length > maxBytes) {
    return wrapPreWithLineNumbers(escapeHtml(code));
  }
  const lang = toShikiLang(backendLang);
  if (lang === 'txt') {
    return wrapPreWithLineNumbers(escapeHtml(code));
  }
  try {
    const { codeToHtml } = await import('shiki');
    const pair = THEME_PAIRS[opts.colorScheme ?? 'standard'];
    return await codeToHtml(code, {
      lang,
      themes: pair,
      defaultColor: false,
      transformers: [transformerLineMeta],
    });
  } catch {
    return wrapPreWithLineNumbers(escapeHtml(code));
  }
}

/**
 * 降级路径:把 escapeHtml 后的纯文本按 \n 切行,每行包成 .line + 行号 gutter,
 * 与 Shiki 路径的 DOM 结构对齐,以便共用 scss(行号样式 / 跳转高亮)。
 */
function wrapPreWithLineNumbers(escaped: string): string {
  const lines = escaped.split('\n');
  const inner = lines
    .map((ln, i) => {
      const n = i + 1;
      return `<span class="line" data-line="${n}"><span class="shiki-line-number" aria-hidden="true">${n}</span>${ln}</span>`;
    })
    .join('\n');
  return `<pre><code>${inner}</code></pre>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export const escapeHtmlForTest = escapeHtml;
