/**
 * AnsiFilter 单测
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { AnsiFilter } from './ansi-filter.js';

const ENTER = '\x1b[?1049h';
const EXIT = '\x1b[?1049l';

describe('AnsiFilter', () => {
  let f: AnsiFilter;

  beforeEach(() => {
    f = new AnsiFilter();
  });

  it('正常文本透传', () => {
    expect(f.filter('hello world')).toBe('hello world');
    expect(f.currentMode).toBe('normal');
  });

  it('单 chunk 内 enter → 切 alt 模式，enter 序列保留', () => {
    expect(f.filter(`pre${ENTER}inside`)).toBe(`pre${ENTER}`);
    expect(f.currentMode).toBe('alt');
  });

  it('alt 模式下输出被丢弃', () => {
    f.filter(`pre${ENTER}`);
    expect(f.filter('hidden inside')).toBe('');
    expect(f.currentMode).toBe('alt');
  });

  it('单 chunk 内 enter + exit → 中间内容被丢弃', () => {
    const r = f.filter(`pre${ENTER}hidden${EXIT}post`);
    expect(r).toBe(`pre${ENTER}${EXIT}post`);
    expect(f.currentMode).toBe('normal');
  });

  it('跨 chunk 的 enter（ESC 在前 chunk 末，序列其它在下一 chunk）', () => {
    expect(f.filter('hello\x1b')).toBe('hello');
    expect(f.currentMode).toBe('normal'); // 还没识别到完整 enter
    expect(f.filter('[?1049hinside')).toBe(ENTER);
    expect(f.currentMode).toBe('alt');
  });

  it('跨 chunk 的 exit（ESC 在前 chunk 末）', () => {
    f.filter(`${ENTER}hidden\x1b`);
    expect(f.currentMode).toBe('alt');
    expect(f.filter('[?1049lpost')).toBe(`${EXIT}post`);
    expect(f.currentMode).toBe('normal');
  });

  it('alt 内嵌套 ESC 不会被误识别为 exit', () => {
    f.filter(`pre${ENTER}`);
    // 一段普通带 ESC 的 ANSI（非 1049l）
    expect(f.filter('\x1b[31mhidden')).toBe('');
    expect(f.currentMode).toBe('alt');
  });

  it('reset 后回到 normal 且无 pending', () => {
    f.filter(`${ENTER}hidden\x1b`);
    f.reset();
    expect(f.currentMode).toBe('normal');
    expect(f.filter('back to normal')).toBe('back to normal');
  });

  it('多次进出 alt screen', () => {
    expect(f.filter('a')).toBe('a');
    expect(f.filter(ENTER)).toBe(ENTER);
    expect(f.filter('hidden1')).toBe('');
    expect(f.filter(EXIT)).toBe(EXIT);
    expect(f.filter('b')).toBe('b');
    expect(f.filter(ENTER)).toBe(ENTER);
    expect(f.filter(EXIT)).toBe(EXIT);
    expect(f.currentMode).toBe('normal');
  });

  it('单纯 ESC 落在末尾被 pending 起来不影响下一段非 enter', () => {
    expect(f.filter('foo\x1b')).toBe('foo');
    // 下一 chunk 是 'bar'（非 enter 前缀）→ pending 应被丢回去重新走过滤
    // 但当前实现把 pending 当 enter 前缀，'\x1b' + 'bar' 中 '\x1bb' 不是
    // ALT_ENTER 前缀，所以 cutTrailingEsc 在 \x1bbar 上不会再 pending；
    // 我们应该输出 \x1bbar
    expect(f.filter('bar')).toBe('\x1bbar');
  });
});
