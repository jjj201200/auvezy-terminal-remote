/**
 * syntax-highlight 单测 — 只验降级路径,不强断 Shiki 真实输出
 * (jsdom 里 Shiki 加载可能成功也可能失败,网络/缓存依赖)。
 */

import { describe, it, expect } from 'vitest';
import { highlight, escapeHtmlForTest } from './syntax-highlight.js';

describe('highlight', () => {
  it('超过 maxBytes 文本走降级(不调 shiki,内容仍可见)', async () => {
    const big = 'x'.repeat(11 * 1024);
    const lines = await highlight(big, 'ts', { maxBytes: 10 * 1024 });
    // 降级是单行 escapeHtml,行号 + 内容包在 .line span 里
    expect(lines.length).toBe(1);
    expect(lines[0]).toContain('x');
    expect(lines[0]).toContain('class="line"');
    // 降级路径不含 Shiki <pre class="shiki ..."> 容器
    expect(lines[0]).not.toMatch(/<pre[^>]*class="shiki/);
  });

  it('未指定 maxBytes 时小文本不降级(走 shiki 或 shiki 异常时降级)', async () => {
    const small = 'const x = 1;';
    const lines = await highlight(small, 'ts');
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.join('')).toContain('x');
  });

  it('未知 lang 走降级 escapeHtml', async () => {
    const lines = await highlight('hello <world>', 'xyz-not-real-lang');
    expect(lines.join('')).toContain('&lt;world&gt;');
  });

  it('escapeHtmlForTest 正确转义五大字符', () => {
    expect(escapeHtmlForTest('<a&b>"c\'')).toBe('&lt;a&amp;b&gt;&quot;c&#39;');
  });

  it('多行降级输出每行独立 .line', async () => {
    const lines = await highlight('a\nb\nc', 'xyz', {});
    expect(lines.length).toBe(3);
    expect(lines[0]).toContain('data-line="1"');
    expect(lines[2]).toContain('data-line="3"');
  });
});
