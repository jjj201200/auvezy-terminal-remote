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
} from './config.js';

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
