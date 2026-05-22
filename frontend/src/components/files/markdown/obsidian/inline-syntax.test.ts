/**
 * remarkObsidianInline 单测
 *
 * 覆盖 4 种 inline 语法识别 + 边界 case:
 *   ==highlight== / %%comment%% / #tag(letter 开头,非数字) / ^block-id(行尾)
 * + enabled=false 时全 no-op(保留原文)。
 *
 * 用 unified + remark-parse 拿 mdast,JSON.stringify 后断言关键 hName 出现。
 * 不渲染 React,纯 AST 测试 — 速度快且独立于 react-markdown 行为。
 */

import { describe, it, expect } from 'vitest';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import { remarkObsidianInline } from './inline-syntax.js';

function parse(md: string, enabled = true): string {
  const tree = unified()
    .use(remarkParse)
    .use(remarkObsidianInline, { enabled })
    .parse(md);
  // 这里 .parse 不跑 transformer;手动 runSync 让 plugin 跑
  const processor = unified().use(remarkParse).use(remarkObsidianInline, { enabled });
  const ran = processor.runSync(tree);
  return JSON.stringify(ran);
}

describe('remarkObsidianInline — highlight ==text==', () => {
  it('recognizes ==text==', () => {
    expect(parse('hello ==bright== world')).toContain('"obs-highlight"');
  });
  it('keeps raw text when enabled=false', () => {
    expect(parse('hello ==bright== world', false)).not.toContain('"obs-highlight"');
  });
});

describe('remarkObsidianInline — comment %%text%%', () => {
  it('recognizes inline comment', () => {
    expect(parse('visible %%hidden%% rest')).toContain('"obs-comment"');
  });
  it('keeps raw text when enabled=false', () => {
    expect(parse('visible %%hidden%% rest', false)).not.toContain('"obs-comment"');
  });
});

describe('remarkObsidianInline — tag #tag', () => {
  it('recognizes #project (letter start)', () => {
    expect(parse('see #project today')).toContain('"obs-tag"');
  });
  it('recognizes #notes/2026 (nested with slash)', () => {
    expect(parse('tagged #notes/2026')).toContain('"obs-tag"');
  });
  it('does NOT recognize #123 (numeric only,no letter start)', () => {
    expect(parse('issue #123 here')).not.toContain('"obs-tag"');
  });
  it('does NOT recognize text#frag (no whitespace before #)', () => {
    expect(parse('url#fragment here')).not.toContain('"obs-tag"');
  });
  it('keeps raw text when enabled=false', () => {
    expect(parse('tagged #project here', false)).not.toContain('"obs-tag"');
  });
});

describe('remarkObsidianInline — block id ^id', () => {
  it('recognizes line-end ^id', () => {
    expect(parse('paragraph end ^abc-1')).toContain('"obs-block-id"');
  });
  it('does NOT recognize mid-line ^id (not line-end)', () => {
    expect(parse('text ^abc more text')).not.toContain('"obs-block-id"');
  });
  it('keeps raw text when enabled=false', () => {
    expect(parse('paragraph end ^abc', false)).not.toContain('"obs-block-id"');
  });
});
