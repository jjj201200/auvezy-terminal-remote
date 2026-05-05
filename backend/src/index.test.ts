/**
 * index 模块测试：仅测纯函数 helper。
 * startServer 全流程不在此覆盖（涉及网络 / PTY / 文件系统，由 e2e 层测）。
 */

import { describe, it, expect } from 'vitest';
import { resolveAnsiFilterEnabled, isFullAltScreenTui } from './index.js';

describe('isFullAltScreenTui', () => {
  it('内置名单全命中', () => {
    expect(isFullAltScreenTui('claude')).toBe(true);
    expect(isFullAltScreenTui('tmux')).toBe(true);
    expect(isFullAltScreenTui('screen')).toBe(true);
    expect(isFullAltScreenTui('vim')).toBe(true);
    expect(isFullAltScreenTui('nvim')).toBe(true);
    expect(isFullAltScreenTui('htop')).toBe(true);
    expect(isFullAltScreenTui('less')).toBe(true);
    expect(isFullAltScreenTui('fzf')).toBe(true);
    expect(isFullAltScreenTui('lazygit')).toBe(true);
    expect(isFullAltScreenTui('k9s')).toBe(true);
  });

  it('claude-* 前缀也命中', () => {
    expect(isFullAltScreenTui('claude-code')).toBe(true);
    expect(isFullAltScreenTui('claude-foo')).toBe(true);
  });

  it('完整路径取 basename', () => {
    expect(isFullAltScreenTui('/usr/local/bin/claude')).toBe(true);
    expect(isFullAltScreenTui('C:\\\\bin\\\\nvim.exe')).toBe(true);
  });

  it('普通 shell / 命令行工具不命中', () => {
    expect(isFullAltScreenTui('zsh')).toBe(false);
    expect(isFullAltScreenTui('bash')).toBe(false);
    expect(isFullAltScreenTui('ls')).toBe(false);
    expect(isFullAltScreenTui('node')).toBe(false);
    expect(isFullAltScreenTui('python')).toBe(false);
  });

  it('用户追加名单生效', () => {
    expect(isFullAltScreenTui('foo')).toBe(false);
    expect(isFullAltScreenTui('foo', 'foo')).toBe(true);
    expect(isFullAltScreenTui('foo', 'bar,foo,baz')).toBe(true);
  });

  it('追加名单大小写不敏感、空白容错', () => {
    expect(isFullAltScreenTui('FOO', 'foo')).toBe(true);
    expect(isFullAltScreenTui('foo', '  bar , foo ,  baz  ')).toBe(true);
  });

  it('空字符串 / undefined 安全', () => {
    expect(isFullAltScreenTui('')).toBe(false);
    expect(isFullAltScreenTui('', undefined)).toBe(false);
    expect(isFullAltScreenTui('zsh', '')).toBe(false);
  });
});

describe('resolveAnsiFilterEnabled', () => {
  it('默认关（无 env override）', () => {
    expect(resolveAnsiFilterEnabled('zsh', undefined)).toBe(false);
    expect(resolveAnsiFilterEnabled('bash', undefined)).toBe(false);
    expect(resolveAnsiFilterEnabled('claude', undefined)).toBe(false);
    expect(resolveAnsiFilterEnabled('/usr/bin/tmux', undefined)).toBe(false);
  });

  it('OCR_ANSI_FILTER=true 对非 alt-screen 命令生效', () => {
    expect(resolveAnsiFilterEnabled('zsh', 'true')).toBe(true);
    expect(resolveAnsiFilterEnabled('bash', '1')).toBe(true);
    expect(resolveAnsiFilterEnabled('node', 'yes')).toBe(true);
  });

  it('OCR_ANSI_FILTER=true + 全程 alt-screen TUI → 仍然关（保护性）', () => {
    expect(resolveAnsiFilterEnabled('claude', 'true')).toBe(false);
    expect(resolveAnsiFilterEnabled('tmux', 'true')).toBe(false);
    expect(resolveAnsiFilterEnabled('vim', '1')).toBe(false);
    expect(resolveAnsiFilterEnabled('lazygit', 'yes')).toBe(false);
  });

  it('OCR_ANSI_FILTER=true + OCR_ANSI_FILTER_TUI_NAMES 用户名单也保护', () => {
    expect(resolveAnsiFilterEnabled('myapp', 'true', 'myapp')).toBe(false);
    expect(resolveAnsiFilterEnabled('myapp', 'true', 'foo,myapp,bar')).toBe(false);
    // 不在名单的命令仍然开
    expect(resolveAnsiFilterEnabled('zsh', 'true', 'myapp')).toBe(true);
  });

  it('OCR_ANSI_FILTER=false 显式关，所有命令一律关', () => {
    expect(resolveAnsiFilterEnabled('zsh', 'false')).toBe(false);
    expect(resolveAnsiFilterEnabled('claude', '0')).toBe(false);
    expect(resolveAnsiFilterEnabled('vim', 'no')).toBe(false);
  });

  it('OCR_ANSI_FILTER 非法值忽略，回退默认（关）', () => {
    expect(resolveAnsiFilterEnabled('zsh', 'maybe')).toBe(false);
    expect(resolveAnsiFilterEnabled('zsh', '')).toBe(false);
  });
});
