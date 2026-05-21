/**
 * syntax-highlight 单测 — 只验降级路径,不强断 Shiki 真实输出
 * (jsdom 里 Shiki 加载可能成功也可能失败,网络/缓存依赖)。
 */

import { describe, it, expect } from 'vitest';
import { highlight, escapeHtmlForTest } from './syntax-highlight.js';

describe('highlight', () => {
  it('超过 maxBytes 文本走降级(不调 shiki,内容仍可见)', async () => {
    const big = 'x'.repeat(11 * 1024);
    const html = await highlight(big, 'ts', { maxBytes: 10 * 1024 });
    expect(html).toContain('x');
    // 降级路径自带 .line + .shiki-line-number gutter,但不含 Shiki codeToHtml
    // 输出的 <pre class="shiki ..."> 容器签名
    expect(html).not.toMatch(/<pre[^>]*class="shiki/);
  });

  it('未指定 maxBytes 时小文本不降级(走 shiki 或 shiki 异常时降级)', async () => {
    const small = 'const x = 1;';
    const html = await highlight(small, 'ts');
    expect(html).toContain('x');
  });

  it('未知 lang 走降级 escapeHtml', async () => {
    const html = await highlight('hello <world>', 'xyz-not-real-lang');
    expect(html).toContain('&lt;world&gt;');
  });

  it('escapeHtmlForTest 正确转义五大字符', () => {
    expect(escapeHtmlForTest('<a&b>"c\'')).toBe('&lt;a&amp;b&gt;&quot;c&#39;');
  });
});
