/**
 * skills-scanner / mcp-scanner 单测
 *
 * fixture 全部建在 os.tmpdir() 下的临时目录，afterAll 统一清理，
 * 不触碰真实 ~/.claude、~/.agents、~/.codex。
 */

import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  parseSkillFrontmatter,
  scanClaudeSkills,
  scanCodexSkills,
} from './skills-scanner.js';
import {
  parseCodexTomlMcpServers,
  scanClaudeMcp,
  scanCodexMcp,
} from './mcp-scanner.js';

const base = mkdtempSync(join(tmpdir(), 'atr-discovery-test-'));
const home = join(base, 'home');
const cwd = join(base, 'proj');
mkdirSync(home, { recursive: true });
mkdirSync(cwd, { recursive: true });

/** 快捷建文件（自动建父目录） */
function put(p: string, content: string): void {
  mkdirSync(join(p, '..'), { recursive: true });
  writeFileSync(p, content, 'utf8');
}

afterAll(() => {
  rmSync(base, { recursive: true, force: true });
});

// ──────────────── parseSkillFrontmatter ────────────────

describe('parseSkillFrontmatter', () => {
  it('标准 frontmatter：name + description', () => {
    const r = parseSkillFrontmatter('---\nname: deploy\ndescription: 部署到生产\n---\n\n正文');
    expect(r.name).toBe('deploy');
    expect(r.description).toBe('部署到生产');
  });

  it('引号值剥引号', () => {
    const r = parseSkillFrontmatter('---\nname: "deploy"\ndescription: \'说 "你好"\'\n---\n');
    expect(r.name).toBe('deploy');
    expect(r.description).toBe('说 "你好"');
  });

  it('无 frontmatter → 空对象', () => {
    expect(parseSkillFrontmatter('# 直接正文\n')).toEqual({});
  });

  it('frontmatter 未闭合 → 空对象', () => {
    expect(parseSkillFrontmatter('---\nname: x\n')).toEqual({});
  });

  it('缺 name 时 name 为 undefined', () => {
    const r = parseSkillFrontmatter('---\ndescription: 只有描述\n---\n');
    expect(r.name).toBeUndefined();
    expect(r.description).toBe('只有描述');
  });
});

// ──────────────── scanClaudeSkills ────────────────

describe('scanClaudeSkills', () => {
  it('用户级 skills + 旧式 commands + 项目级两层全发现，invoke 用 / 前缀', async () => {
    put(join(home, '.claude', 'skills', 'deploy', 'SKILL.md'),
      '---\nname: deploy\ndescription: 部署\n---\n正文');
    put(join(home, '.claude', 'commands', 'daily-report.md'),
      '---\ndescription: 日报\n---\n内容');
    put(join(cwd, '.claude', 'skills', 'local-tool', 'SKILL.md'),
      '正文（无 frontmatter，name 应取目录名）');
    // 无 SKILL.md 的目录应被跳过
    mkdirSync(join(home, '.claude', 'skills', 'not-a-skill'), { recursive: true });

    const r = await scanClaudeSkills({ home, cwd });
    const names = r.map((s) => s.name);
    expect(names).toContain('deploy');
    expect(names).toContain('daily-report');
    expect(names).toContain('local-tool');
    expect(names).not.toContain('not-a-skill');

    const deploy = r.find((s) => s.name === 'deploy')!;
    expect(deploy.tui).toBe('claude');
    expect(deploy.kind).toBe('skill');
    expect(deploy.source).toBe('user');
    expect(deploy.invoke).toBe('/deploy ');

    const daily = r.find((s) => s.name === 'daily-report')!;
    expect(daily.kind).toBe('command');
    expect(daily.description).toBe('日报');

    const local = r.find((s) => s.name === 'local-tool')!;
    expect(local.source).toBe('project');
    expect(local.description).toBeUndefined();
  });

  it('目录不存在 → 空数组不报错', async () => {
    const emptyHome = join(base, 'empty-home');
    mkdirSync(emptyHome, { recursive: true });
    const r = await scanClaudeSkills({ home: emptyHome, cwd: join(base, 'no-such-cwd') });
    expect(r).toEqual([]);
  });
});

// ──────────────── scanCodexSkills ────────────────

describe('scanCodexSkills', () => {
  it('用户级 .agents/skills + git root 到 cwd 每级项目目录，invoke 用 $ 前缀', async () => {
    // git repo：proj/.git 存在；proj/packages/app 为 cwd
    const repo = cwd;
    const deep = join(repo, 'packages', 'app');
    mkdirSync(join(repo, '.git'), { recursive: true });
    mkdirSync(deep, { recursive: true });

    put(join(home, '.agents', 'skills', 'global-skill', 'SKILL.md'),
      '---\nname: global-skill\ndescription: 全局\n---\n');
    put(join(repo, '.agents', 'skills', 'repo-skill', 'SKILL.md'),
      '---\nname: repo-skill\n---\n');
    put(join(deep, '.agents', 'skills', 'app-skill', 'SKILL.md'),
      '---\nname: app-skill\n---\n');

    const r = await scanCodexSkills({ home, cwd: deep });
    const names = r.map((s) => s.name);
    expect(names).toEqual(['global-skill', 'repo-skill', 'app-skill']);

    const g = r.find((s) => s.name === 'global-skill')!;
    expect(g.tui).toBe('codex');
    expect(g.source).toBe('user');
    expect(g.invoke).toBe('$global-skill ');
    expect(r.find((s) => s.name === 'repo-skill')!.source).toBe('project');
  });

  it('无 .git 时退化为只扫 cwd 一级（不向上扫到 /）', async () => {
    const noGit = join(base, 'no-git-proj');
    mkdirSync(noGit, { recursive: true });
    // 故意在 base（祖先）放一个 .agents，不应被发现
    put(join(base, '.agents', 'skills', 'ancestor-skill', 'SKILL.md'), '---\nname: ancestor-skill\n---\n');
    put(join(noGit, '.agents', 'skills', 'cwd-skill', 'SKILL.md'), '---\nname: cwd-skill\n---\n');

    const r = await scanCodexSkills({ home: join(base, 'no-home'), cwd: noGit });
    const names = r.map((s) => s.name);
    expect(names).toEqual(['cwd-skill']);
  });
});

// ──────────────── parseCodexTomlMcpServers ────────────────

describe('parseCodexTomlMcpServers', () => {
  it('stdio（command+args）与 http（url）混合、引号名、子表不断段', () => {
    const toml = [
      '# 注释',
      'model = "gpt-6.1"',
      '',
      '[mcp_servers.context7]',
      'command = "npx"',
      'args = ["-y", "@upstash/context7-mcp"]',
      '',
      '[mcp_servers.context7.env]',
      'MY_VAR = "value"',
      '',
      '[mcp_servers."figma 奇怪名"]',
      'url = "https://mcp.figma.com/mcp" # 行尾注释',
      'bearer_token_env_var = "TOKEN"',
      '',
      '[features]',
      'hooks = true',
    ].join('\n');
    const r = parseCodexTomlMcpServers(toml, 'user');
    expect(r).toHaveLength(2);
    expect(r[0]).toEqual({
      tui: 'codex', name: 'context7', transport: 'stdio', source: 'user',
      detail: 'npx -y @upstash/context7-mcp',
    });
    expect(r[1]).toEqual({
      tui: 'codex', name: 'figma 奇怪名', transport: 'http', source: 'user',
      detail: 'https://mcp.figma.com/mcp',
    });
  });

  it('脏条目（无 command 无 url）被丢弃；空文本返回空数组', () => {
    expect(parseCodexTomlMcpServers('[mcp_servers.broken]\nargs = ["x"]\n', 'project')).toEqual([]);
    expect(parseCodexTomlMcpServers('', 'user')).toEqual([]);
  });
});

// ──────────────── scanClaudeMcp / scanCodexMcp ────────────────

describe('scanClaudeMcp', () => {
  it('用户级 .claude.json + 项目级 .mcp.json 都发现，transport 判定正确', async () => {
    put(join(home, '.claude.json'), JSON.stringify({
      mcpServers: {
        userStdio: { command: 'npx', args: ['-y', 'server'] },
        userHttp: { type: 'http', url: 'https://mcp.example.com/mcp' },
        broken: { foo: 1 },
      },
      projects: { '/big': { history: [] } },
    }));
    put(join(cwd, '.mcp.json'), JSON.stringify({
      mcpServers: { projSse: { type: 'sse', url: 'https://proj.example.com/sse' } },
    }));

    const r = await scanClaudeMcp({ home, cwd });
    expect(r).toHaveLength(3);
    const stdio = r.find((s) => s.name === 'userStdio')!;
    expect(stdio.transport).toBe('stdio');
    expect(stdio.source).toBe('user');
    expect(stdio.detail).toBe('npx -y server');
    const http = r.find((s) => s.name === 'userHttp')!;
    expect(http.transport).toBe('http');
    const proj = r.find((s) => s.name === 'projSse')!;
    expect(proj.source).toBe('project');
    expect(r.find((s) => s.name === 'broken')).toBeUndefined();
  });

  it('配置文件缺失或损坏 → 空数组不抛', async () => {
    put(join(home, '.claude.json'), '{broken json');
    const r = await scanClaudeMcp({ home, cwd: join(base, 'no-cwd') });
    expect(r).toEqual([]);
  });
});

describe('scanCodexMcp', () => {
  it('用户级与项目级 config.toml 各自解析', async () => {
    put(join(home, '.codex', 'config.toml'),
      '[mcp_servers.user-one]\ncommand = "uvx"\nargs = ["mcp-server"]\n');
    put(join(cwd, '.codex', 'config.toml'),
      '[mcp_servers.proj-one]\nurl = "https://x.example.com/mcp"\n');

    const r = await scanCodexMcp({ home, cwd });
    expect(r).toHaveLength(2);
    expect(r.find((s) => s.name === 'user-one')!.source).toBe('user');
    expect(r.find((s) => s.name === 'proj-one')!.transport).toBe('http');
  });
});
