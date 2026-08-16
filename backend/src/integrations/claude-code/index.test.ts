/**
 * ClaudeCodeIntegration 组合层测试
 *
 * detect 的 viaShellFallback 分支(shell 函数 fallback 场景下 command 是
 * $SHELL,无法从命令名识别 claude)与 prepareSpawn 的 env 注入通道。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ClaudeCodeIntegration, CLAUDE_CONFIG_DIR_ENV } from './index.js';

describe('ClaudeCodeIntegration.detect - viaShellFallback', () => {
  const mod = () => new ClaudeCodeIntegration();

  it('claude 命名照旧命中', () => {
    expect(mod().detect({ command: 'claude', args: [], port: 1 })).toBe(true);
  });

  it('fallback 场景:command 是 $SHELL 但 viaShellFallback=true → 命中(zclaude 函数)', () => {
    expect(
      mod().detect({ command: '/usr/bin/zsh', args: ['-ic', "'zclaude'"], port: 1, viaShellFallback: true }),
    ).toBe(true);
  });

  it('非 fallback 的裸 shell → 不命中(atr bash 里手动敲 claude 不注入)', () => {
    expect(mod().detect({ command: 'bash', args: [], port: 1 })).toBe(false);
  });
});

describe('ClaudeCodeIntegration.prepareSpawn - env 注入通道', () => {
  let base: string;

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), 'atr-cc-integration-'));
  });
  afterEach(() => {
    rmSync(base, { recursive: true, force: true });
  });

  it('镜像 settings.json 的 hooks 指向实例端口', () => {
    const mod = new ClaudeCodeIntegration({ settingsBaseDir: base });
    const aug = mod.prepareSpawn({ command: 'claude', args: [], port: 41237 });
    const dir = aug?.extraEnv?.[CLAUDE_CONFIG_DIR_ENV];
    expect(dir).toBeDefined();
    expect(existsSync(join(dir!, 'settings.json'))).toBe(true);
    const settings = JSON.parse(readFileSync(join(dir!, 'settings.json'), 'utf-8')) as {
      hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>>;
    };
    expect(settings.hooks['PreToolUse'][0].hooks[0].command).toContain('127.0.0.1:41237/api/hook');
    expect(aug?.extraArgs).toBeUndefined(); // 不再走 --settings 参数通道
    mod.shutdown();
    expect(existsSync(dir!)).toBe(false); // shutdown 清理镜像
  });
});
