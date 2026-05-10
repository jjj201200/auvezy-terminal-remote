/**
 * instance-path 单测
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  getInstanceIdFromPath,
  buildInstancePath,
  pushInstancePath,
} from './instance-path.js';

describe('getInstanceIdFromPath', () => {
  it('/i/<id>/ → id', () => {
    expect(getInstanceIdFromPath('/i/abc-123/')).toBe('abc-123');
  });

  it('/i/<id>/api/foo → id', () => {
    expect(getInstanceIdFromPath('/i/abc-123/api/foo')).toBe('abc-123');
  });

  it('/i/<id> 不带尾斜杠 → id', () => {
    expect(getInstanceIdFromPath('/i/abc-123')).toBe('abc-123');
  });

  it('/ → null', () => {
    expect(getInstanceIdFromPath('/')).toBeNull();
  });

  it('/some/other/path → null', () => {
    expect(getInstanceIdFromPath('/some/other/path')).toBeNull();
  });

  it('空字符串 → null', () => {
    expect(getInstanceIdFromPath('')).toBeNull();
  });

  it('UUID 形式正确解析', () => {
    expect(getInstanceIdFromPath('/i/d4eef0bc-82cf-4074-9f50-848d0a607132/'))
      .toBe('d4eef0bc-82cf-4074-9f50-848d0a607132');
  });
});

describe('buildInstancePath', () => {
  it('返回 /i/<id>/', () => {
    expect(buildInstancePath('abc')).toBe('/i/abc/');
  });
});

describe('pushInstancePath', () => {
  let pushSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // jsdom 提供 window.history.pushState；我们 spy 它
    pushSpy = vi.spyOn(window.history, 'pushState');
  });

  afterEach(() => {
    pushSpy.mockRestore();
  });

  it('调 history.pushState(null, "", "/i/<id>/")', () => {
    pushInstancePath('xyz');
    expect(pushSpy).toHaveBeenCalledWith(null, '', '/i/xyz/');
  });

  it('当前 URL 已是目标路径 → 不重复推', () => {
    window.history.pushState(null, '', '/i/dup/');
    pushSpy.mockClear();
    pushInstancePath('dup');
    expect(pushSpy).not.toHaveBeenCalled();
  });
});
