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
 *
 * 注:theme 参数已不再决定输出 — 现在统一走 multi-themes(light + dark) +
 * defaultColor:false,token 颜色作为 CSS 变量;实际选哪套由容器 css class /
 * prefers-color-scheme 决定。保留参数仅为向后兼容旧调用方,可传可不传。
 */
export async function highlight(
  code: string,
  backendLang: string,
  _theme: SupportedTheme,
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
    // 用 multi-themes + defaultColor:false 让 Shiki 只输出 token 着色(CSS 变量),
    // 不写入 background/color 内联样式;容器的底色/前景由项目 scss 用 design token
    // 接管(--color-bg-canvas / --color-fg 等),与用户显示设置一致。
    // 同时输出 light 与 dark 两套 token 颜色变量,scss 用 prefers-color-scheme
    // / 容器类切换。
    return await codeToHtml(code, {
      lang,
      themes: { light: 'github-light', dark: 'github-dark' },
      defaultColor: false,
    });
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
