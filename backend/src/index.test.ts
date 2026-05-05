/**
 * index 模块测试：仅测纯函数 helper。
 * startServer 全流程不在此覆盖（涉及网络 / PTY / 文件系统，由 e2e 层测）。
 */

import { describe, it, expect } from 'vitest';
import { resolveAnsiFilterEnabled } from './index.js';

describe('resolveAnsiFilterEnabled', () => {
  it('默认关（无 env override）', () => {
    expect(resolveAnsiFilterEnabled('zsh', undefined)).toBe(false);
    expect(resolveAnsiFilterEnabled('bash', undefined)).toBe(false);
    expect(resolveAnsiFilterEnabled('claude', undefined)).toBe(false);
    expect(resolveAnsiFilterEnabled('/usr/bin/tmux', undefined)).toBe(false);
  });

  it('OCR_ANSI_FILTER=true 强制开', () => {
    expect(resolveAnsiFilterEnabled('zsh', 'true')).toBe(true);
    expect(resolveAnsiFilterEnabled('zsh', '1')).toBe(true);
    expect(resolveAnsiFilterEnabled('zsh', 'yes')).toBe(true);
    expect(resolveAnsiFilterEnabled('zsh', 'TRUE')).toBe(true);
  });

  it('OCR_ANSI_FILTER=false 显式关', () => {
    expect(resolveAnsiFilterEnabled('zsh', 'false')).toBe(false);
    expect(resolveAnsiFilterEnabled('zsh', '0')).toBe(false);
    expect(resolveAnsiFilterEnabled('zsh', 'no')).toBe(false);
  });

  it('OCR_ANSI_FILTER 非法值忽略，回退默认（关）', () => {
    expect(resolveAnsiFilterEnabled('zsh', 'maybe')).toBe(false);
    expect(resolveAnsiFilterEnabled('zsh', '')).toBe(false);
  });
});
