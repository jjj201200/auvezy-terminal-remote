/**
 * isClaudeCommand 单测
 *
 * 替代原 backend/src/config.test.ts 的 shouldInjectSettings 测试。
 * 注:ATR_INJECT_SETTINGS 强制开关已废弃——通过 IntegrationManager 的
 * forceModule='claude-code' / 'none' 实现等效语义。
 */

import { describe, it, expect } from 'vitest';
import { isClaudeCommand } from './detect.js';

describe('isClaudeCommand', () => {
  it('裸名 claude → true', () => {
    expect(isClaudeCommand('claude')).toBe(true);
  });

  it('绝对路径但 basename 是 claude → true', () => {
    expect(isClaudeCommand('/usr/local/bin/claude')).toBe(true);
  });

  it('claude- 前缀(claude-dev / claude-canary) → true', () => {
    expect(isClaudeCommand('claude-dev')).toBe(true);
    expect(isClaudeCommand('/opt/bin/claude-canary')).toBe(true);
  });

  it('.exe / .cmd / .bat 后缀(含大小写) → true', () => {
    expect(isClaudeCommand('claude.exe')).toBe(true);
    expect(isClaudeCommand('Claude.EXE')).toBe(true);
    expect(isClaudeCommand('claude.cmd')).toBe(true);
    expect(isClaudeCommand('claude.bat')).toBe(true);
  });

  it('claude 前缀但不是 claude- 模式(如 claudefoo) → false', () => {
    expect(isClaudeCommand('claudefoo')).toBe(false);
  });

  it('shell / 解释器 → false', () => {
    expect(isClaudeCommand('bash')).toBe(false);
    expect(isClaudeCommand('zsh')).toBe(false);
    expect(isClaudeCommand('/bin/sh')).toBe(false);
    expect(isClaudeCommand('python3')).toBe(false);
  });
});
