/**
 * config 模块单测
 *
 * 覆盖：
 *  - createClaudeSettings：无 existing / 与用户 settings 合并 / 同名 hook 覆盖告警
 *  - saveClaudeSettings：写入路径形如 <baseDir>/settings/<port>.json + 内容可解析
 *  - extractSettingsFromArgs：--settings <path> / --settings <inline-json> / --settings=<value> / 不存在 → null / 解析失败 → 保留原 args
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import {
  createClaudeSettings,
  saveClaudeSettings,
  extractSettingsFromArgs,
  loadUserConfig,
  saveUserConfig,
  loadConfig,
  shouldInjectSettings,
} from './config.js';
import { DEFAULT_SHORTCUTS, DEFAULT_COMMANDS, DEFAULT_PORT } from '@ocr/shared';
import type { ParsedCliArgs } from './cli-utils.js';

describe('createClaudeSettings', () => {
  it('无 existing → 仅返回我们的 hooks', () => {
    const s = createClaudeSettings(8080);
    const hooks = (s as { hooks: Record<string, unknown> }).hooks;
    expect(hooks).toHaveProperty('Notification');
    expect(hooks).toHaveProperty('PreToolUse');
  });

  it('hook command 包含 curl + 端口', () => {
    const s = createClaudeSettings(12345) as {
      hooks: {
        Notification: Array<{ hooks: Array<{ command: string }> }>;
      };
    };
    const cmd = s.hooks.Notification[0]!.hooks[0]!.command;
    expect(cmd).toContain('curl');
    expect(cmd).toContain('http://127.0.0.1:12345/api/hook');
  });

  it('与用户 settings 合并：保留其它字段，hooks 覆盖同名事件', () => {
    const existing = {
      env: { FOO: 'bar' },
      hooks: {
        Notification: [{ matcher: 'old' }],
        SomeOther: [{ matcher: 'x' }],
      },
    };
    const s = createClaudeSettings(8080, existing) as {
      env: Record<string, string>;
      hooks: Record<string, unknown>;
    };
    expect(s.env).toEqual({ FOO: 'bar' });
    // SomeOther 保留
    expect(s.hooks).toHaveProperty('SomeOther');
    // Notification 被我们覆盖（不再是 'old'）
    const notif = (s.hooks['Notification'] as Array<{ matcher: string }>)[0]!;
    expect(notif.matcher).toBe('permission_prompt');
  });

  it('existing.hooks 不是对象时回退为空对象', () => {
    const s = createClaudeSettings(8080, { hooks: 'invalid' }) as {
      hooks: Record<string, unknown>;
    };
    expect(s.hooks).toHaveProperty('Notification');
    expect(s.hooks).toHaveProperty('PreToolUse');
  });
});

describe('saveClaudeSettings', () => {
  let baseDir: string;

  beforeEach(() => {
    baseDir = mkdtempSync(resolve(tmpdir(), 'ocr-config-test-'));
  });

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true });
  });

  it('写入到 <baseDir>/settings/<port>.json，内容可被 JSON.parse', () => {
    const settings = createClaudeSettings(9999);
    const p = saveClaudeSettings(settings, 9999, baseDir);
    expect(p).toBe(resolve(baseDir, 'settings', '9999.json'));
    expect(existsSync(p)).toBe(true);
    const parsed = JSON.parse(readFileSync(p, 'utf-8'));
    expect(parsed).toHaveProperty('hooks');
  });
});

describe('extractSettingsFromArgs', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(resolve(tmpdir(), 'ocr-args-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('未指定 --settings → null', () => {
    expect(extractSettingsFromArgs(['--foo', 'bar'])).toBeNull();
  });

  it('--settings <file> 形式：读文件并 JSON.parse', () => {
    const file = resolve(tmpDir, 'user.json');
    writeFileSync(file, JSON.stringify({ env: { K: 'V' } }));
    const r = extractSettingsFromArgs(['--foo', '--settings', file, '--bar']);
    expect(r).not.toBeNull();
    expect(r!.value).toEqual({ env: { K: 'V' } });
    expect(r!.source).toBe(file);
    expect(r!.remainingArgs).toEqual(['--foo', '--bar']);
  });

  it('--settings=<inline json> 形式', () => {
    const r = extractSettingsFromArgs(['--settings={"a":1}', '--keep']);
    expect(r).not.toBeNull();
    expect(r!.value).toEqual({ a: 1 });
    expect(r!.source).toBe('inline');
    expect(r!.remainingArgs).toEqual(['--keep']);
  });

  it('--settings <inline json> 形式（空格分隔）', () => {
    const r = extractSettingsFromArgs(['--settings', '{"x":true}']);
    expect(r).not.toBeNull();
    expect(r!.value).toEqual({ x: true });
  });

  it('--settings <无法解析值> → null（remainingArgs 保留原参数交给 claude）', () => {
    const r = extractSettingsFromArgs(['--settings', 'not-a-file-or-json', '--keep']);
    expect(r).toBeNull();
  });

  it('--settings <文件解析失败> → null', () => {
    const file = resolve(tmpDir, 'bad.json');
    writeFileSync(file, 'this is not valid json');
    const r = extractSettingsFromArgs(['--settings', file]);
    expect(r).toBeNull();
  });

  it('多次出现 --settings：后者覆盖前者', () => {
    const r = extractSettingsFromArgs([
      '--settings',
      '{"first":true}',
      '--settings',
      '{"second":true}',
    ]);
    expect(r).not.toBeNull();
    expect(r!.value).toEqual({ second: true });
  });
});

describe('loadUserConfig', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(resolve(tmpdir(), 'ocr-uc-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('文件不存在 → 写默认 + created=true', () => {
    const path = resolve(tmpDir, 'config.json');
    const r = loadUserConfig(path);
    expect(r.created).toBe(true);
    expect(r.recovered).toBe(false);
    expect(existsSync(path)).toBe(true);
    expect(r.value.shortcuts).toEqual(DEFAULT_SHORTCUTS);
  });

  it('文件已存在且合法 → 不重写，ensureDefaultUserConfig 兜底缺失字段', () => {
    const path = resolve(tmpDir, 'config.json');
    writeFileSync(path, JSON.stringify({ fontScale: 1.5 }));
    const r = loadUserConfig(path);
    expect(r.created).toBe(false);
    expect(r.recovered).toBe(false);
    expect(r.value.fontScale).toBe(1.5);
    // shortcuts 缺失 → 默认值兜底
    expect(r.value.shortcuts).toEqual(DEFAULT_SHORTCUTS);
    expect(r.value.commands).toEqual(DEFAULT_COMMANDS);
  });

  it('JSON 损坏 → 备份原文件 + 落默认 + recovered=true', () => {
    const path = resolve(tmpDir, 'config.json');
    writeFileSync(path, '{not valid json');
    const r = loadUserConfig(path);
    expect(r.recovered).toBe(true);
    expect(r.value.shortcuts).toEqual(DEFAULT_SHORTCUTS);
    // 应该能找到一个 .corrupted-* 备份文件
    const fs = require('node:fs');
    const files = fs.readdirSync(tmpDir);
    expect(files.some((f: string) => f.includes('.corrupted-'))).toBe(true);
  });
});

describe('saveUserConfig', () => {
  let tmpDir: string;
  beforeEach(() => {
    tmpDir = mkdtempSync(resolve(tmpdir(), 'ocr-su-'));
  });
  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('atomic 写入 + 内容可解析', () => {
    const path = resolve(tmpDir, 'config.json');
    saveUserConfig({ fontScale: 2.0 }, path);
    const back = JSON.parse(readFileSync(path, 'utf-8'));
    expect(back.fontScale).toBe(2.0);
  });
});

describe('loadConfig（CLI > env > 默认）', () => {
  const baseCli: ParsedCliArgs = { subcommand: 'start', claudeArgs: [] };

  it('全空 → 内建默认', () => {
    const cfg = loadConfig({
      cli: baseCli,
      env: {},
      generateToken: () => 'gen-token',
      loadUser: () => ({
        path: '/tmp/x.json',
        value: { shortcuts: DEFAULT_SHORTCUTS, commands: DEFAULT_COMMANDS },
        created: false,
        recovered: false,
      }),
    });
    expect(cfg.port).toBe(DEFAULT_PORT);
    expect(cfg.token).toBe('gen-token');
    expect(cfg.tokenSource).toBe('generated');
  });

  it('CLI 覆盖 env', () => {
    const cfg = loadConfig({
      cli: { ...baseCli, port: 9999, token: 'cli-tok' },
      env: { PORT: '4444', AUTH_TOKEN: 'env-tok' },
      generateToken: () => 'gen',
      loadUser: () => ({
        path: '/tmp/x.json',
        value: {},
        created: false,
        recovered: false,
      }),
    });
    expect(cfg.port).toBe(9999);
    expect(cfg.token).toBe('cli-tok');
    expect(cfg.tokenSource).toBe('cli');
  });

  it('env 覆盖默认；token=env', () => {
    const cfg = loadConfig({
      cli: baseCli,
      env: { PORT: '4444', AUTH_TOKEN: 'env-tok', NO_TERMINAL: 'true' },
      generateToken: () => 'gen',
      loadUser: () => ({
        path: '/tmp/x.json',
        value: {},
        created: false,
        recovered: false,
      }),
    });
    expect(cfg.port).toBe(4444);
    expect(cfg.tokenSource).toBe('env');
    expect(cfg.noTerminal).toBe(true);
  });

  it('CLI workdir 优先；instanceName 缺省 = basename(workdir)', () => {
    const cfg = loadConfig({
      cli: { ...baseCli, workdir: '/tmp/myproject' },
      env: {},
      generateToken: () => 'gen',
      loadUser: () => ({
        path: '/tmp/x.json',
        value: {},
        created: false,
        recovered: false,
      }),
    });
    expect(cfg.claudeCwd).toBe('/tmp/myproject');
    expect(cfg.instanceName).toBe('myproject');
  });

  it('claudeArgs：CLI 优先于 env OCR_ARGS', () => {
    const cfg = loadConfig({
      cli: { ...baseCli, claudeArgs: ['--cli-arg'] },
      env: { OCR_ARGS: '["--env-arg"]' },
      generateToken: () => 'gen',
      loadUser: () => ({
        path: '/tmp/x.json',
        value: {},
        created: false,
        recovered: false,
      }),
    });
    expect(cfg.claudeArgs).toEqual(['--cli-arg']);
  });

  it('env：旧名 CLAUDE_* 仍然兼容（向后兼容）', () => {
    const cfg = loadConfig({
      cli: baseCli,
      env: {
        CLAUDE_COMMAND: 'bash',
        CLAUDE_ARGS: '["-c","echo hi"]',
        CLAUDE_CWD: '/tmp/legacy',
      },
      generateToken: () => 'gen',
      loadUser: () => ({
        path: '/tmp/x.json',
        value: {},
        created: false,
        recovered: false,
      }),
    });
    expect(cfg.claudeCommand).toBe('bash');
    expect(cfg.claudeArgs).toEqual(['-c', 'echo hi']);
    expect(cfg.claudeCwd).toBe('/tmp/legacy');
  });

  it('env：新名 OCR_* 优先于旧名 CLAUDE_*', () => {
    const cfg = loadConfig({
      cli: baseCli,
      env: {
        OCR_COMMAND: 'zsh',
        CLAUDE_COMMAND: 'bash',
      },
      generateToken: () => 'gen',
      loadUser: () => ({
        path: '/tmp/x.json',
        value: {},
        created: false,
        recovered: false,
      }),
    });
    expect(cfg.claudeCommand).toBe('zsh');
  });
});

describe('shouldInjectSettings', () => {
  it('command 是 claude → true', () => {
    expect(shouldInjectSettings('claude', undefined)).toBe(true);
  });

  it('command 带绝对路径但 basename 是 claude → true', () => {
    expect(shouldInjectSettings('/usr/local/bin/claude', undefined)).toBe(true);
  });

  it('command 带 claude- 前缀 → true（覆盖 claude-dev / claude-canary 等）', () => {
    expect(shouldInjectSettings('claude-dev', undefined)).toBe(true);
    expect(shouldInjectSettings('/opt/bin/claude-canary', undefined)).toBe(true);
  });

  it('.exe / .cmd 后缀也能识别（含大小写）', () => {
    expect(shouldInjectSettings('claude.exe', undefined)).toBe(true);
    expect(shouldInjectSettings('Claude.EXE', undefined)).toBe(true);
    expect(shouldInjectSettings('claude.cmd', undefined)).toBe(true);
  });

  it('bash / zsh / sh 等 shell → false（不会被坑）', () => {
    expect(shouldInjectSettings('bash', undefined)).toBe(false);
    expect(shouldInjectSettings('zsh', undefined)).toBe(false);
    expect(shouldInjectSettings('/bin/sh', undefined)).toBe(false);
    expect(shouldInjectSettings('python3', undefined)).toBe(false);
  });

  it('OCR_INJECT_SETTINGS=true 强制开（即使是 bash）', () => {
    expect(shouldInjectSettings('bash', 'true')).toBe(true);
    expect(shouldInjectSettings('bash', '1')).toBe(true);
    expect(shouldInjectSettings('bash', 'YES')).toBe(true);
  });

  it('OCR_INJECT_SETTINGS=false 强制关（即使是 claude）', () => {
    expect(shouldInjectSettings('claude', 'false')).toBe(false);
    expect(shouldInjectSettings('claude', '0')).toBe(false);
    expect(shouldInjectSettings('claude', 'No')).toBe(false);
  });

  it('OCR_INJECT_SETTINGS 是无效值时落回自动判定', () => {
    expect(shouldInjectSettings('claude', 'maybe')).toBe(true);
    expect(shouldInjectSettings('bash', 'whatever')).toBe(false);
  });
});
