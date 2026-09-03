/**
 * instance-name 单测：nextInstanceName 序号避让 + truncateName 保后缀截断
 */

import { describe, it, expect } from 'vitest';
import { nextInstanceName, truncateName } from './instance-name.js';

describe('nextInstanceName', () => {
  it('无冲突 → 原样 base（首个实例不加序号）', () => {
    expect(nextInstanceName('myproj', [])).toBe('myproj');
  });

  it('base 被占 → -2', () => {
    expect(nextInstanceName('myproj', ['myproj'])).toBe('myproj-2');
  });

  it('base 和 -2 都被占 → -3', () => {
    expect(nextInstanceName('myproj', ['myproj', 'myproj-2'])).toBe('myproj-3');
  });

  it('跳号场景 → max+1 而非计数（不复用已死实例的号）', () => {
    expect(nextInstanceName('myproj', ['myproj', 'myproj-5'])).toBe('myproj-6');
  });

  it('裸名空缺（只有 -2 活着）→ 裸名可用', () => {
    expect(nextInstanceName('myproj', ['myproj-2'])).toBe('myproj');
  });

  it('前缀更长的不算冲突（foobar ≠ foo）', () => {
    expect(nextInstanceName('foo', ['foobar'])).toBe('foo');
  });

  it('非纯数字后缀不算冲突（foo-bar ≠ foo-N）', () => {
    expect(nextInstanceName('foo', ['foo-bar'])).toBe('foo');
  });

  it('大小写敏感（FOO 与 foo 可并存）', () => {
    expect(nextInstanceName('foo', ['FOO'])).toBe('foo');
  });

  it('前导零序号仍识别（foo-02 计为 2）', () => {
    expect(nextInstanceName('foo', ['foo', 'foo-02'])).toBe('foo-3');
  });
});

describe('truncateName', () => {
  it('不超长 → 原样', () => {
    expect(truncateName('myproj', 30)).toBe('myproj');
  });

  it('恰好等于 max → 原样', () => {
    expect(truncateName('a'.repeat(10), 10)).toBe('a'.repeat(10));
  });

  it('超长且无数字后缀 → 直接截断（与旧 slice 行为一致）', () => {
    expect(truncateName('b'.repeat(35), 30)).toBe('b'.repeat(30));
  });

  it('超长且带序号 → 截 basename 保 -N 后缀', () => {
    const name = 'c'.repeat(34) + '-2'; // 总长 36 > 30
    const out = truncateName(name, 30);
    expect(out).toBe('c'.repeat(28) + '-2');
    expect(out.length).toBe(30);
  });

  it('后缀比 max 还长 → 保数字头部，长度不超 max', () => {
    const out = truncateName('x-1234567890123456789012345678901234', 10);
    expect(out).toBe('1234567890');
    expect(out.length).toBeLessThanOrEqual(10);
  });
});
