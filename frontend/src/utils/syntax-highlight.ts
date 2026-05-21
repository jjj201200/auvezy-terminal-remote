/**
 * Shiki 包装 + 多重降级。返回每行 HTML 片段(string[]),由 TextPreview 用
 * 虚拟列表逐行渲染,避免大文件一次性 DOM 创建 20 万节点导致主线程卡死。
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
 * 给每行 <span class="line"> 重构成"行号列 + 内容列"两列:
 *   <span class="line" data-line="N">
 *     <span class="shiki-line-number">N</span>
 *     <span class="line-content"> ...原 token spans... </span>
 *   </span>
 *
 * Why 必须 wrap token spans:.line 是 grid 容器,grid auto-flow 会让每个直接
 * 子元素占一格 → 8 个 token span = 8 列。包到 .line-content 里后 .line 永远
 * 只有 2 个直接子,grid-template-columns 的 2 列声明真正生效。
 */
const transformerLineMeta: ShikiTransformer = {
  name: 'atr:line-meta',
  line(node, line) {
    node.properties['data-line'] = String(line);
    // 把原 children 全部挪到 .line-content 内
    const content = {
      type: 'element' as const,
      tagName: 'span',
      properties: { class: 'line-content' },
      children: node.children,
    };
    node.children = [
      {
        type: 'element' as const,
        tagName: 'span',
        properties: { class: 'shiki-line-number', 'aria-hidden': 'true' },
        children: [{ type: 'text', value: String(line) }],
      },
      content,
    ];
  },
};

/**
 * 高亮一段文本,返回每行的 HTML 片段(每个元素是一个 <span class="line">...</span>)。
 * TextPreview 把数组喂给虚拟列表逐行渲染。
 */
export async function highlight(
  code: string,
  backendLang: string,
  opts: HighlightOptions = {},
): Promise<string[]> {
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_HIGHLIGHT_BYTES;
  if (code.length > maxBytes) {
    return fallbackLines(code);
  }
  const lang = toShikiLang(backendLang);
  if (lang === 'txt') {
    return fallbackLines(code);
  }
  try {
    const { codeToHtml } = await import('shiki');
    const pair = THEME_PAIRS[opts.colorScheme ?? 'standard'];
    const html = await codeToHtml(code, {
      lang,
      themes: pair,
      defaultColor: false,
      transformers: [transformerLineMeta],
    });
    return extractLineSpans(html);
  } catch {
    return fallbackLines(code);
  }
}

/**
 * 从 Shiki codeToHtml 完整输出中抠出每个顶层 <span class="line">...</span>。
 *
 * Why 走 DOMParser 而非正则:Shiki 输出 token 嵌套 <span style="..">,正则切
 * 行容易在 token 含 ">" 字符或属性内含 ".line" 子串时出错。浏览器原生
 * DOMParser 直接解析 HTML 字符串,querySelectorAll(".line") 拿全部行节点
 * 后取 outerHTML 即可,既精确又比正则短。
 */
function extractLineSpans(shikiHtml: string): string[] {
  const doc = new DOMParser().parseFromString(shikiHtml, 'text/html');
  return Array.from(doc.querySelectorAll('.line'), (n) => (n as HTMLElement).outerHTML);
}

/**
 * 降级路径:escapeHtml + 按 \n 切行 + 包 .line + 行号 gutter,
 * 与 Shiki 路径的 DOM 结构对齐,以便共用 scss(行号样式 / 跳转高亮)。
 */
function fallbackLines(raw: string): string[] {
  const lines = raw.split('\n');
  return lines.map((ln, i) => {
    const n = i + 1;
    return `<span class="line" data-line="${n}"><span class="shiki-line-number" aria-hidden="true">${n}</span><span class="line-content">${escapeHtml(ln)}</span></span>`;
  });
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
