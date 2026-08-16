/**
 * config-dir-mirror 单元测试
 *
 * 镜像 ~/.claude 到 atr 数据目录:settings.json 顶替(合并用户原配置 + atr hooks),
 * 其余 entry 全部 symlink 透传(登录态/历史/projects/skills 等零拷贝共享)。
 * 配合 PTY env 注入 CLAUDE_CONFIG_DIR,claude 以任何方式启动(直接/函数/wrapper)
 * 都能读到 atr 的 hooks——不再依赖 --settings 参数转发与命令名 detect。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readdirSync, existsSync, readlinkSync, statSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { buildConfigDirMirror } from './config-dir-mirror.js';
import { DEFAULT_CLAUDE_CODE_EVENTS } from './settings-builder.js';

function tmp(): string {
  return mkdtempSync(join(tmpdir(), 'atr-mirror-test-'));
}

describe('buildConfigDirMirror', () => {
  let realDir: string;
  let mirrorBase: string;

  beforeEach(() => {
    const root = tmp();
    realDir = join(root, 'claude-real');
    mirrorBase = join(root, 'claude-mirror');
    mkdirSync(realDir, { recursive: true });
    // 模拟 ~/.claude:settings.json + 凭据 + 目录
    writeFileSync(join(realDir, 'settings.json'), JSON.stringify({ model: 'opus' }));
    writeFileSync(join(realDir, '.credentials.json'), '{"tok":"x"}');
    mkdirSync(join(realDir, 'projects'));
    writeFileSync(join(realDir, 'projects', 'some-session.jsonl'), '{}');
    mkdirSync(mirrorBase, { recursive: true });
  });

  afterEach(() => {
    rmSync(dirname(realDir), { recursive: true, force: true });
  });

  it('settings.json 被顶替为 atr 版(合并用户原值 + hooks)', () => {
    const dir = buildConfigDirMirror({
      mirrorBaseDir: mirrorBase,
      realConfigDir: realDir,
      port: 41234,
      toggles: DEFAULT_CLAUDE_CODE_EVENTS,
    });

    const settings = JSON.parse(
      readFileSync(join(dir, 'settings.json'), 'utf-8'),
    ) as { model?: string; hooks?: Record<string, unknown> };
    expect(settings.model).toBe('opus'); // 用户原配置保留
    expect(settings.hooks).toBeDefined(); // atr hooks 注入
    const hookCmd = (settings.hooks!['PreToolUse'] as Array<{ hooks: Array<{ command: string }> }>)[0].hooks[0].command;
    expect(hookCmd).toContain('127.0.0.1:41234/api/hook');
  });

  it('其余 entry 全部 symlink 透传(凭据/目录)', () => {
    const dir = buildConfigDirMirror({
      mirrorBaseDir: mirrorBase,
      realConfigDir: realDir,
      port: 41234,
      toggles: DEFAULT_CLAUDE_CODE_EVENTS,
    });

    expect(readlinkSync(join(dir, '.credentials.json'))).toBe(join(realDir, '.credentials.json'));
    expect(readlinkSync(join(dir, 'projects'))).toBe(join(realDir, 'projects'));
    // symlink 目录内容可达(登录态共享)
    expect(existsSync(join(dir, 'projects', 'some-session.jsonl'))).toBe(true);
  });

  it('幂等:二次调用不报错、symlink 不重复创建', () => {
    const opts = { mirrorBaseDir: mirrorBase, realConfigDir: realDir, port: 41234, toggles: DEFAULT_CLAUDE_CODE_EVENTS };
    buildConfigDirMirror(opts);
    buildConfigDirMirror(opts); // 第二次 no-op
    // mirror 下没有套娃
    const entries = readdirSync(join(mirrorBase, '41234'));
    expect(entries.sort()).toEqual(['.credentials.json', 'projects', 'settings.json'].sort());
  });

  it('realConfigDir 不存在(用户从未跑过 claude):只写 settings,不建 symlink', () => {
    const dir = buildConfigDirMirror({
      mirrorBaseDir: mirrorBase,
      realConfigDir: join(mirrorBase, '..', 'no-such-claude'),
      port: 41235,
      toggles: DEFAULT_CLAUDE_CODE_EVENTS,
    });
    const entries = readdirSync(dir);
    expect(entries).toEqual(['settings.json']);
  });

  it('镜像目录权限 0o700,settings 0o600', () => {
    const dir = buildConfigDirMirror({
      mirrorBaseDir: mirrorBase,
      realConfigDir: realDir,
      port: 41236,
      toggles: DEFAULT_CLAUDE_CODE_EVENTS,
    });
    expect((statSync(dir).mode & 0o777).toString(8)).toBe('700');
    expect((statSync(join(dir, 'settings.json')).mode & 0o777).toString(8)).toBe('600');
  });

  it('不同端口各自独立目录(hooks URL 不同)', () => {
    const d1 = buildConfigDirMirror({ mirrorBaseDir: mirrorBase, realConfigDir: realDir, port: 1, toggles: DEFAULT_CLAUDE_CODE_EVENTS });
    const d2 = buildConfigDirMirror({ mirrorBaseDir: mirrorBase, realConfigDir: realDir, port: 2, toggles: DEFAULT_CLAUDE_CODE_EVENTS });
    expect(d1).not.toBe(d2);
    expect(existsSync(d1) && existsSync(d2)).toBe(true);
  });
});
