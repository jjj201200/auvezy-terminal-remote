/**
 * syntax-highlight 单测
 *
 * 重点验降级路径:
 *  - 超过 maxBytes 直接 escapeHtml,不调 shiki
 *  - 未知 lang 走 escapeHtml
 *  - escapeHtml 五大字符正确转义
 *
 * Shiki 真实加载在 jsdom 里可能成功也可能失败(取决于网络/缓存);
 * 我们不直接断言"shiki 输出含什么",只断"降级路径正确,不抛"。
 */

import { describe, it, expect } from 'vitest';
import { highlight, escapeHtmlForTest } from './syntax-highlight.js';

describe('highlight', () => {
  it('超过 maxBytes 文本走降级(不调 shiki,内容仍可见)', async () => {
    const big = 'x'.repeat(11 * 1024);
    // 显式传 maxBytes=10 KiB,确保 11 KiB 文本超阈值
    const html = await highlight(big, 'ts', 'github-dark', { maxBytes: 10 * 1024 });
    expect(html).toContain('x');
    expect(html).not.toContain('class="shiki');
  });

  it('未指定 maxBytes 时小文本不降级(走 shiki 或 shiki 异常时降级)', async () => {
    const small = 'const x = 1;';
    const html = await highlight(small, 'ts', 'github-dark');
    // 不强断 shiki 加载成功,只验内容仍可见
    expect(html).toContain('x');
  });

  it('未知 lang 走降级 escapeHtml', async () => {
    const html = await highlight('hello <world>', 'xyz-not-real-lang', 'github-dark');
    expect(html).toContain('&lt;world&gt;');
  });

  it('escapeHtmlForTest 正确转义五大字符', () => {
    expect(escapeHtmlForTest('<a&b>"c\'')).toBe('&lt;a&amp;b&gt;&quot;c&#39;');
  });
});
