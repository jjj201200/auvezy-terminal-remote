/**
 * config-dir-mirror 单元测试
 *
 * 镜像 ~/.claude 到 atr 数据目录:settings.json 顶替(合并用户原配置 + atr hooks),
 * 其余 entry 全部 symlink 透传(登录态/历史/projects/skills 等零拷贝共享)。
 * 配合 PTY env 注入 CLAUDE_CONFIG_DIR,claude 以任何方式启动(直接/函数/wrapper)
 * 都能读到 atr 的 hooks——不再依赖 --settings 参数转发与命令名 detect。
 *
 * 0.18 起(ADR-002)镜像按项目 cwd 命名(对齐 claude projects/<sanitized-cwd>
 * 惯例),同项目多实例共享;hooks 端口经 ATR_HOOK_PORT env 注入,settings 内容
 * 与实例无关。.claude.json symlink 指向顶级 ~/.claude.json(修正旧版误链
 * 目录内同名文件的 bug——该 bug 曾导致直跑/经 atr 双身份分裂)。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readdirSync, existsSync, readlinkSync, statSync, readFileSync, lstatSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { buildConfigDirMirror } from './config-dir-mirror.js';

function tmp(): string {
  return mkdtempSync(join(tmpdir(), 'atr-mirror-test-'));
}

describe('buildConfigDirMirror - 按项目命名', () => {
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

  it('镜像子目录名为转义后的项目 cwd(非字母数字→-)', () => {
    const dir = buildConfigDirMirror({
      mirrorBaseDir: mirrorBase,
      realConfigDir: realDir,
      cwd: '/mnt/d/github/observer',
    });
    expect(dir).toBe(join(mirrorBase, '-mnt-d-github-observer'));
  });

  it('同项目 cwd 多实例共享同一镜像目录', () => {
    const d1 = buildConfigDirMirror({ mirrorBaseDir: mirrorBase, realConfigDir: realDir, cwd: '/mnt/d/github/observer' });
    const d2 = buildConfigDirMirror({ mirrorBaseDir: mirrorBase, realConfigDir: realDir, cwd: '/mnt/d/github/observer' });
    expect(d1).toBe(d2);
  });

  it('不同项目 cwd 各自独立目录', () => {
    const d1 = buildConfigDirMirror({ mirrorBaseDir: mirrorBase, realConfigDir: realDir, cwd: '/mnt/d/github/observer' });
    const d2 = buildConfigDirMirror({ mirrorBaseDir: mirrorBase, realConfigDir: realDir, cwd: '/mnt/d/github/df-market' });
    expect(d1).not.toBe(d2);
    expect(existsSync(d1) && existsSync(d2)).toBe(true);
  });

  it('超长 cwd 截断并追加 hash 后缀(防文件系统路径上限)', () => {
    const longCwd = '/mnt/d/' + 'project-'.repeat(30);
    const dir = buildConfigDirMirror({ mirrorBaseDir: mirrorBase, realConfigDir: realDir, cwd: longCwd });
    const name = dir.slice(mirrorBase.length + 1);
    expect(name.length).toBeLessThanOrEqual(180);
    expect(name).toMatch(/-[0-9a-f]{8}$/);
  });

  it('settings.json 被顶替为 atr 版(合并用户原值 + hooks,端口走 env)', () => {
    const dir = buildConfigDirMirror({
      mirrorBaseDir: mirrorBase,
      realConfigDir: realDir,
      cwd: '/mnt/d/github/observer',
    });

    const settings = JSON.parse(
      readFileSync(join(dir, 'settings.json'), 'utf-8'),
    ) as { model?: string; hooks?: Record<string, unknown> };
    expect(settings.model).toBe('opus'); // 用户原配置保留
    expect(settings.hooks).toBeDefined(); // atr hooks 注入
    const hookCmd = (settings.hooks!['PreToolUse'] as Array<{ hooks: Array<{ command: string }> }>)[0].hooks[0].command;
    expect(hookCmd).toContain('${ATR_HOOK_PORT:-1}');
  });

  it('其余 entry 全部 symlink 透传(凭据/目录)', () => {
    const dir = buildConfigDirMirror({
      mirrorBaseDir: mirrorBase,
      realConfigDir: realDir,
      cwd: '/mnt/d/github/observer',
    });

    expect(readlinkSync(join(dir, '.credentials.json'))).toBe(join(realDir, '.credentials.json'));
    expect(readlinkSync(join(dir, 'projects'))).toBe(join(realDir, 'projects'));
    // symlink 目录内容可达(登录态共享)
    expect(existsSync(join(dir, 'projects', 'some-session.jsonl'))).toBe(true);
  });

  it('.claude.json:目录内同名文件不透传,symlink 指向顶级状态文件', () => {
    // 造双份:顶级 ~/.claude.json(直跑会话的现行状态)与目录内 .claude.json(历史误产物)
    const root = dirname(realDir);
    const topLevel = join(root, '.claude.json');
    const inDir = join(realDir, '.claude.json');
    writeFileSync(topLevel, '{"numStartups":436}');
    writeFileSync(inDir, '{"numStartups":111}');
    try {
      const dir = buildConfigDirMirror({
        mirrorBaseDir: mirrorBase,
        realConfigDir: realDir,
        cwd: '/mnt/d/github/observer',
      });
      // 指向顶级(直跑现行状态),而非目录内同名文件
      expect(readlinkSync(join(dir, '.claude.json'))).toBe(topLevel);
      expect(readlinkSync(join(dir, '.claude.json'))).not.toBe(inDir);
    } finally {
      rmSync(topLevel, { force: true });
      rmSync(inDir, { force: true });
    }
  });

  it('顶级状态文件 .claude.json 不存在时不建 symlink(首跑用户)', () => {
    const dir = buildConfigDirMirror({
      mirrorBaseDir: mirrorBase,
      realConfigDir: realDir,
      cwd: '/mnt/d/github/observer',
    });
    expect(existsSync(join(dir, '.claude.json'))).toBe(false);
  });

  it('幂等:二次调用不报错、symlink 不重复创建', () => {
    const opts = { mirrorBaseDir: mirrorBase, realConfigDir: realDir, cwd: '/mnt/d/github/observer' };
    buildConfigDirMirror(opts);
    buildConfigDirMirror(opts); // 第二次 no-op
    // mirror 下没有套娃
    const entries = readdirSync(join(mirrorBase, '-mnt-d-github-observer'));
    expect(entries.sort()).toEqual(['.credentials.json', 'projects', 'settings.json'].sort());
  });

  it('realConfigDir 不存在(用户从未跑过 claude):只写 settings,不建 symlink', () => {
    const dir = buildConfigDirMirror({
      mirrorBaseDir: mirrorBase,
      realConfigDir: join(mirrorBase, '..', 'no-such-claude'),
      cwd: '/mnt/d/github/observer',
    });
    const entries = readdirSync(dir);
    expect(entries).toEqual(['settings.json']);
  });

  it('镜像目录权限 0o700,settings 0o600', () => {
    const dir = buildConfigDirMirror({
      mirrorBaseDir: mirrorBase,
      realConfigDir: realDir,
      cwd: '/mnt/d/github/observer',
    });
    expect((statSync(dir).mode & 0o777).toString(8)).toBe('700');
    expect((statSync(join(dir, 'settings.json')).mode & 0o777).toString(8)).toBe('600');
  });
});

/**
 * plugins 目录隔离:Claude Code 把市场 installLocation / 插件 installPath 以
 * 绝对路径写进 plugins/known_marketplaces.json 与 installed_plugins.json,
 * 并强校验其位于当前 CLAUDE_CONFIG_DIR 内。多实例 symlink 共享一份注册表
 * 时任一实例写入都会让其它实例(含官方 ~/.claude 环境)报 marketplace
 * corrupted——plugins 必须每镜像独立副本,拷贝后归一注册表路径。
 */
describe('buildConfigDirMirror:plugins 独立副本', () => {
  let realDir: string;
  let mirrorBase: string;

  beforeEach(() => {
    const root = tmp();
    realDir = join(root, 'claude-real');
    mirrorBase = join(root, 'claude-mirror');
    mkdirSync(mirrorBase, { recursive: true });
    // 模拟官方 ~/.claude:settings.json + plugins 注册表(含官方/异实例前缀混合)
    mkdirSync(realDir, { recursive: true });
    writeFileSync(join(realDir, 'settings.json'), '{}');
    const pluginsDir = join(realDir, 'plugins');
    mkdirSync(join(pluginsDir, 'marketplaces', 'df-market', '.claude-plugin'), { recursive: true });
    mkdirSync(join(pluginsDir, 'cache', 'df-market', 'glm', '0.5.0'), { recursive: true });
    writeFileSync(join(pluginsDir, 'marketplaces', 'df-market', '.claude-plugin', 'marketplace.json'), '{}');
    writeFileSync(
      join(pluginsDir, 'known_marketplaces.json'),
      JSON.stringify({
        'df-market': {
          source: { source: 'git', url: 'git@github.com:u/df-market.git' },
          installLocation: '/home/u/.claude/plugins/marketplaces/df-market',
        },
        'zai-coding-plugins': {
          source: { source: 'directory', path: '/home/u/.claude/plugins/marketplaces/zai-coding-plugins' },
          installLocation: '/home/u/.atr/claude-config/41999/plugins/marketplaces/zai-coding-plugins',
        },
      }),
    );
    writeFileSync(
      join(pluginsDir, 'installed_plugins.json'),
      JSON.stringify({
        version: 2,
        plugins: {
          'glm@df-market': [
            {
              scope: 'local',
              installPath: '/home/u/.atr/claude-config/41999/plugins/cache/df-market/glm/0.5.0',
              projectPath: '/mnt/d/github/open-terminal-remote',
            },
          ],
        },
      }),
    );
  });

  afterEach(() => {
    rmSync(dirname(realDir), { recursive: true, force: true });
  });

  function build(cwd: string): string {
    return buildConfigDirMirror({
      mirrorBaseDir: mirrorBase,
      realConfigDir: realDir,
      cwd,
    });
  }

  it('plugins 深拷贝为独立真目录(非 symlink),与官方侧互不影响', () => {
    const dir = build('/mnt/d/github/observer');
    const p = join(dir, 'plugins');
    expect(lstatSync(p).isSymbolicLink()).toBe(false);
    expect(lstatSync(p).isDirectory()).toBe(true);
    // 内容可达
    expect(existsSync(join(p, 'marketplaces', 'df-market', '.claude-plugin', 'marketplace.json'))).toBe(true);
    // 独立:官方侧后续变更不回渗镜像
    writeFileSync(join(realDir, 'plugins', 'marketplaces', 'df-market', 'touched'), 'x');
    expect(existsSync(join(p, 'marketplaces', 'df-market', 'touched'))).toBe(false);
  });

  it('known_marketplaces.json 的 installLocation/source.path 归一为本镜像路径', () => {
    const dir = build('/mnt/d/github/observer');
    const km = JSON.parse(
      readFileSync(join(dir, 'plugins', 'known_marketplaces.json'), 'utf-8'),
    ) as Record<string, { installLocation: string; source: { path?: string } }>;
    expect(km['df-market']!.installLocation).toBe(join(dir, 'plugins', 'marketplaces', 'df-market'));
    expect(km['zai-coding-plugins']!.installLocation).toBe(
      join(dir, 'plugins', 'marketplaces', 'zai-coding-plugins'),
    );
    expect(km['zai-coding-plugins']!.source.path).toBe(
      join(dir, 'plugins', 'marketplaces', 'zai-coding-plugins'),
    );
  });

  it('installed_plugins.json 的 installPath 归一,projectPath 等非 plugins 路径不动', () => {
    const dir = build('/mnt/d/github/observer');
    const ip = JSON.parse(
      readFileSync(join(dir, 'plugins', 'installed_plugins.json'), 'utf-8'),
    ) as { plugins: Record<string, Array<{ installPath: string; projectPath: string }>> };
    const entry = ip.plugins['glm@df-market']![0]!;
    expect(entry.installPath).toBe(join(dir, 'plugins', 'cache', 'df-market', 'glm', '0.5.0'));
    expect(entry.projectPath).toBe('/mnt/d/github/open-terminal-remote');
  });

  it('残留的旧版 plugins symlink 自动替换为真目录(升级兼容)', () => {
    // 预埋旧版产物:镜像子目录里 plugins 是指向官方的 symlink
    const staleDir = join(mirrorBase, '-mnt-d-github-observer');
    mkdirSync(staleDir, { recursive: true });
    symlinkSync(join(realDir, 'plugins'), join(staleDir, 'plugins'));
    const dir = build('/mnt/d/github/observer');
    const p = join(dir, 'plugins');
    expect(lstatSync(p).isSymbolicLink()).toBe(false);
    expect(existsSync(join(p, 'marketplaces', 'df-market'))).toBe(true);
    const km = JSON.parse(
      readFileSync(join(p, 'known_marketplaces.json'), 'utf-8'),
    ) as Record<string, { installLocation: string }>;
    expect(km['df-market']!.installLocation).toBe(join(dir, 'plugins', 'marketplaces', 'df-market'));
  });

  it('官方侧无 plugins 时镜像同样不建 symlink(claude 首跑自初始化)', () => {
    rmSync(join(realDir, 'plugins'), { recursive: true, force: true });
    const dir = build('/mnt/d/github/observer');
    expect(existsSync(join(dir, 'plugins'))).toBe(false);
  });

  it('幂等:二次调用不重拷不报错,归一结果保持', () => {
    const dir = build('/mnt/d/github/observer');
    const kmPath = join(dir, 'plugins', 'known_marketplaces.json');
    const before = readFileSync(kmPath, 'utf-8');
    build('/mnt/d/github/observer');
    expect(readFileSync(kmPath, 'utf-8')).toBe(before);
  });
});
