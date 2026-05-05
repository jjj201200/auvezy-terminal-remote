import { describe, it, expect } from 'vitest';
import { encodeForInput, decodeFromInput } from './escape-codec.js';

describe('encodeForInput', () => {
  it('普通可打印字符原样保留', () => {
    expect(encodeForInput('hello')).toBe('hello');
  });

  it('反斜杠转义为双反斜杠', () => {
    expect(encodeForInput('a\\b')).toBe('a\\\\b');
  });

  it('ESC 转为 \\e', () => {
    expect(encodeForInput('\x1b')).toBe('\\e');
  });

  it('CR LF Tab', () => {
    expect(encodeForInput('\r')).toBe('\\r');
    expect(encodeForInput('\n')).toBe('\\n');
    expect(encodeForInput('\t')).toBe('\\t');
  });

  it('上箭头序列', () => {
    expect(encodeForInput('\x1b[A')).toBe('\\e[A');
  });

  it('其它控制字符走 \\xHH', () => {
    expect(encodeForInput('\x07')).toBe('\\x07');
    expect(encodeForInput('\x1f')).toBe('\\x1f');
    expect(encodeForInput('\x7f')).toBe('\\x7f');
  });

  it('混合', () => {
    expect(encodeForInput('a\x1bb\\c')).toBe('a\\eb\\\\c');
  });
});

describe('decodeFromInput', () => {
  it('普通字符', () => {
    expect(decodeFromInput('hello')).toEqual({ value: 'hello', warning: null });
  });

  it('双反斜杠 -> 反斜杠', () => {
    expect(decodeFromInput('a\\\\b')).toEqual({ value: 'a\\b', warning: null });
  });

  it('\\e -> ESC', () => {
    expect(decodeFromInput('\\e')).toEqual({ value: '\x1b', warning: null });
  });

  it('\\r \\n \\t', () => {
    expect(decodeFromInput('\\r\\n\\t')).toEqual({ value: '\r\n\t', warning: null });
  });

  it('上箭头序列', () => {
    expect(decodeFromInput('\\e[A')).toEqual({ value: '\x1b[A', warning: null });
  });

  it('\\xHH', () => {
    expect(decodeFromInput('\\x07')).toEqual({ value: '\x07', warning: null });
    expect(decodeFromInput('\\x7f')).toEqual({ value: '\x7f', warning: null });
  });

  it('非法转义保留原样并报 warning', () => {
    const r = decodeFromInput('\\q');
    expect(r.value).toBe('\\q');
    expect(r.warning).toMatch(/未识别的转义/);
  });

  it('\\x 后非两位 hex 报 warning', () => {
    const r = decodeFromInput('\\xZZ');
    expect(r.value).toBe('\\xZZ');
    expect(r.warning).toMatch(/不合法的 \\xHH/);
  });

  it('\\x 末尾不足两位报 warning', () => {
    const r = decodeFromInput('\\x1');
    expect(r.value).toBe('\\x1');
    expect(r.warning).toMatch(/不合法的 \\xHH/);
  });

  it('结尾单个反斜杠报 warning', () => {
    const r = decodeFromInput('abc\\');
    expect(r.value).toBe('abc\\');
    expect(r.warning).toMatch(/末尾悬空反斜杠/);
  });
});

describe('roundtrip', () => {
  const cases = [
    '',
    'hello',
    '\x1b',
    '\r\n\t',
    '\x1b[A',
    '\x1b[B',
    '\x1b[D',
    '\x1b[C',
    'a\\b\\c',
    '\x07\x1f\x7f',
    'mixed: \x1b[5~ end',
  ];
  for (const c of cases) {
    it(`encode→decode 等价: ${JSON.stringify(c)}`, () => {
      const r = decodeFromInput(encodeForInput(c));
      expect(r.value).toBe(c);
      expect(r.warning).toBeNull();
    });
  }
});
