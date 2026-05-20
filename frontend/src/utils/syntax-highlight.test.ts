/**
 * syntax-highlight 单测
 *
 * 重点验降级路径:
 *  - 超过 200 KB 直接 escapeHtml,不调 shiki
 *  - 未知 lang 走 escapeHtml
 *  - escapeHtml 五大字符正确转义
 *
 * Shiki 真实加载在 jsdom 里可能成功也可能失败(取决于网络/缓存);
 * 我们不直接断言"shiki 输出含什么",只断"降级路径正确,不抛"。
 */

import { describe, it, expect } from 'vitest';
import { highlight, escapeHtmlForTest } from './syntax-highlight.js';

describe('highlight', () => {
  it('超过 200 KB 文本走降级(不调 shiki,内容仍可见)', async () => {
    const big = 'x'.repeat(201 * 1024);
    const html = await highlight(big, 'ts', 'github-dark');
    expect(html).toContain('x');
    // 降级输出形如 <pre><code>...</code></pre>,不含 shiki 标识 class
    expect(html).not.toContain('class="shiki');
  });

  it('未知 lang 走降级 escapeHtml', async () => {
    const html = await highlight('hello <world>', 'xyz-not-real-lang', 'github-dark');
    expect(html).toContain('&lt;world&gt;');
  });

  it('escapeHtmlForTest 正确转义五大字符', () => {
    expect(escapeHtmlForTest('<a&b>"c\'')).toBe('&lt;a&amp;b&gt;&quot;c&#39;');
  });
});
