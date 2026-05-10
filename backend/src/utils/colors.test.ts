/**
 * colors helper 单测
 *
 * 注意 vitest 默认 stdout 不是 TTY,所以 colorsEnabled() 默认为 false。
 * 测启用路径用 FORCE_COLOR=1。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { c, colorsEnabled, disableColors, resetColorsForTest } from './colors.js';

describe('colors', () => {
  let originalNoColor: string | undefined;
  let originalForceColor: string | undefined;

  beforeEach(() => {
    originalNoColor = process.env['NO_COLOR'];
    originalForceColor = process.env['FORCE_COLOR'];
    delete process.env['NO_COLOR'];
    delete process.env['FORCE_COLOR'];
    resetColorsForTest();
  });

  afterEach(() => {
    if (originalNoColor === undefined) delete process.env['NO_COLOR'];
    else process.env['NO_COLOR'] = originalNoColor;
    if (originalForceColor === undefined) delete process.env['FORCE_COLOR'];
    else process.env['FORCE_COLOR'] = originalForceColor;
    resetColorsForTest();
  });

  it('NO_COLOR 非空 → 关', () => {
    process.env['NO_COLOR'] = '1';
    expect(colorsEnabled()).toBe(false);
    expect(c.green('hi')).toBe('hi');
  });

  it('NO_COLOR 空字符串 → 不算开启', () => {
    // 规范:任意非空值禁用。NO_COLOR="" 视作未设置
    process.env['NO_COLOR'] = '';
    // FORCE_COLOR / TTY 才决定是否启用,这里 vitest 非 TTY → false
    expect(colorsEnabled()).toBe(false);
  });

  it('FORCE_COLOR 非空 → 开', () => {
    process.env['FORCE_COLOR'] = '1';
    expect(colorsEnabled()).toBe(true);
    // pc.green 会返回带 ANSI 转义的串
    expect(c.green('hi')).not.toBe('hi');
    expect(c.green('hi')).toContain('hi');
  });

  it('NO_COLOR 优先级高于 FORCE_COLOR', () => {
    process.env['NO_COLOR'] = '1';
    process.env['FORCE_COLOR'] = '1';
    expect(colorsEnabled()).toBe(false);
  });

  it('disableColors() 一旦调用永久关', () => {
    process.env['FORCE_COLOR'] = '1';
    expect(colorsEnabled()).toBe(true);
    disableColors();
    expect(colorsEnabled()).toBe(false);
    // afterEach() 会调 resetColorsForTest() 复位 forceDisabled
  });
});
