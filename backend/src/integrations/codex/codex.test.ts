/**
 * codex 集成模块单测:detect / hooks-builder / hook-mapper / mirror / trust
 *
 * fixture 全部建在 os.tmpdir(),不触碰真实 ~/.codex;trust 的"哈希与 codex
 * 实现一致"由本机 codex 0.162.1 实测校准(smoke),此处断言结构与稳定性。
 */

import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isCodexCommand } from './detect.js';
import {
  buildCodexHooksJson,
  CODEX_HOOK_COMMAND,
  CODEX_HOOK_EVENTS,
  eventSnakeCase,
} from './hooks-builder.js';
import { mapCodexHookPayload, filterCodexEventsByToggles } from './hook-mapper.js';
import { buildCodexHomeMirror } from './codex-home-mirror.js';
import {
  computeHookTrustHash,
  trustStateKey,
  readCodexTrustStatus,
  grantCodexTrust,
} from './trust.js';
import type { CodexEventToggles } from './hooks-builder.js';

const base = mkdtempSync(join(tmpdir(), 'atr-codex-test-'));
afterAll(() => rmSync(base, { recursive: true, force: true }));

// ──────────────── detect ────────────────

describe('isCodexCommand', () => {
  it('裸名 / 绝对路径 / Windows 后缀命中', () => {
    expect(isCodexCommand('codex')).toBe(true);
    expect(isCodexCommand('/usr/local/bin/codex')).toBe(true);
    expect(isCodexCommand('codex.cmd')).toBe(true);
  });
  it('相似名不误报', () => {
    expect(isCodexCommand('codex-exec')).toBe(false);
    expect(isCodexCommand('mycodex')).toBe(false);
    expect(isCodexCommand('claude')).toBe(false);
  });
});

// ──────────────── hooks-builder ────────────────

describe('buildCodexHooksJson', () => {
  it('结构:顶层 hooks + PascalCase 事件 + matcher 空串 + handler timeout 恒定', () => {
    const json = buildCodexHooksJson() as {
      hooks: Record<string, Array<{ matcher: string; hooks: Array<Record<string, unknown>> }>>;
    };
    expect(Object.keys(json.hooks).sort()).toEqual([...CODEX_HOOK_EVENTS].sort());
    for (const groups of Object.values(json.hooks)) {
      expect(groups).toHaveLength(1);
      expect(groups[0]!.matcher).toBe('');
      const h = groups[0]!.hooks[0]!;
      expect(h['type']).toBe('command');
      expect(h['command']).toBe(CODEX_HOOK_COMMAND);
      expect(h['timeout']).toBe(3); // 参与 trust 哈希身份,必须恒定
      expect(h['async']).toBeUndefined(); // 未写(default false,哈希按 false 复现)
    }
  });

  it('eventSnakeCase 全事件可映射', () => {
    for (const e of CODEX_HOOK_EVENTS) {
      expect(eventSnakeCase(e)).toMatch(/^[a-z_]+$/);
    }
    expect(eventSnakeCase('PermissionRequest')).toBe('permission_request');
    expect(eventSnakeCase('UserPromptSubmit')).toBe('user_prompt_submit');
  });
});

// ──────────────── hook-mapper ────────────────

describe('mapCodexHookPayload', () => {
  it('PermissionRequest → approval_pending,tool_input.description 优先为 detail', () => {
    const events = mapCodexHookPayload({
      hook_event_name: 'PermissionRequest',
      tool_name: 'Bash',
      tool_input: { command: 'rm -rf build', description: '清理构建产物' },
    });
    expect(events).toEqual([
      { kind: 'approval_pending', id: 'pending:Bash', tool: 'Bash', detail: '清理构建产物' },
    ]);
  });

  it('PermissionRequest 无 description → 回退工具摘要', () => {
    const events = mapCodexHookPayload({
      hook_event_name: 'PermissionRequest',
      tool_name: 'Bash',
      tool_input: { command: 'npm test' },
    });
    expect(events[0]).toMatchObject({ kind: 'approval_pending', detail: 'Bash: npm test' });
  });

  it('PreToolUse → tool_started(tool_use_id);PostToolUse → finished + resolved(allow)', () => {
    const started = mapCodexHookPayload({
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      tool_use_id: 'tu-1',
      tool_input: { command: 'ls' },
    });
    expect(started).toEqual([
      { kind: 'tool_started', toolUseId: 'tu-1', tool: 'Bash', summary: 'Bash: ls' },
    ]);
    const finished = mapCodexHookPayload({
      hook_event_name: 'PostToolUse',
      tool_name: 'Bash',
      tool_use_id: 'tu-1',
      tool_response: 'ok',
    });
    expect(finished).toEqual([
      { kind: 'tool_finished', toolUseId: 'tu-1', ok: true },
      { kind: 'approval_resolved', id: 'tu-1', outcome: 'allow' },
    ]);
  });

  it('Stop → turn_ended 带 lastMessage;Interrupt → turn_ended', () => {
    expect(
      mapCodexHookPayload({ hook_event_name: 'Stop', last_assistant_message: '完成' }),
    ).toEqual([{ kind: 'turn_ended', lastMessage: '完成' }]);
    expect(mapCodexHookPayload({ hook_event_name: 'Interrupt' })).toEqual([
      { kind: 'turn_ended' },
    ]);
  });

  it('SessionStart/SessionEnd/Pre/PostCompact → session_event 四相', () => {
    expect(mapCodexHookPayload({ hook_event_name: 'SessionStart', source: 'startup' })).toEqual([
      { kind: 'session_event', phase: 'start', detail: 'startup' },
    ]);
    expect(mapCodexHookPayload({ hook_event_name: 'SessionEnd', reason: 'other' })).toEqual([
      { kind: 'session_event', phase: 'end', detail: 'other' },
    ]);
    expect(mapCodexHookPayload({ hook_event_name: 'PreCompact', trigger: 'manual' })[0]).toMatchObject(
      { kind: 'session_event', phase: 'compact_start', detail: 'manual' },
    );
    expect(mapCodexHookPayload({ hook_event_name: 'PostCompact', trigger: 'auto' })[0]).toMatchObject(
      { kind: 'session_event', phase: 'compact_end', detail: 'auto' },
    );
  });

  it('UserPromptSubmit → user_prompt;SubagentStart 一期不翻译', () => {
    expect(mapCodexHookPayload({ hook_event_name: 'UserPromptSubmit', prompt: 'hi' })).toEqual([
      { kind: 'user_prompt', text: 'hi' },
    ]);
    expect(mapCodexHookPayload({ hook_event_name: 'SubagentStart', agent_type: 'x' })).toEqual([]);
  });
});

describe('filterCodexEventsByToggles', () => {
  const all: CodexEventToggles = {
    approvals: true,
    toolProgress: true,
    turnLifecycle: true,
    sessionLifecycle: true,
    userPrompts: false,
  };
  it('关 approvals → approval_pending 丢弃;关 toolProgress → tool/resolved 丢弃', () => {
    const pending = [{ kind: 'approval_pending', id: 'x', tool: 'Bash' }] as never;
    expect(filterCodexEventsByToggles(pending, { ...all, approvals: false })).toEqual([]);
    const tool = [
      { kind: 'tool_started', toolUseId: 't', tool: 'Bash', summary: 's' },
    ] as never;
    expect(filterCodexEventsByToggles(tool, { ...all, toolProgress: false })).toEqual([]);
  });
  it('user_prompt 随 userPrompts||approvals(approvals 开时兜底保留)', () => {
    const up = [{ kind: 'user_prompt', text: 'x' }] as never;
    expect(filterCodexEventsByToggles(up, { ...all, userPrompts: false })).toHaveLength(1);
    expect(
      filterCodexEventsByToggles(up, { ...all, userPrompts: false, approvals: false }),
    ).toEqual([]);
  });
});

// ──────────────── codex-home-mirror ────────────────

describe('buildCodexHomeMirror', () => {
  it('symlink 透传 + hooks.json 生成(幂等:内容不变 mtime 不变)', async () => {
    const home = join(base, 'home1');
    const real = join(home, '.codex');
    mkdirSync(join(real, 'sessions'), { recursive: true });
    writeFileSync(join(real, 'auth.json'), '{"token":"x"}');
    writeFileSync(join(real, 'config.toml'), 'model = "gpt-6.1"');
    // 用户自己的 hooks.json 不透传(由 atr 版顶替)
    writeFileSync(join(real, 'hooks.json'), '{"hooks":{}}');

    const mirrorBase = join(base, 'mirror1');
    const dir = buildCodexHomeMirror({
      mirrorBaseDir: mirrorBase,
      realCodexHome: real,
      cwd: '/tmp/proj a',
    });
    // auth.json/config.toml/sessions 均为 symlink;hooks.json 为真实文件
    expect(readFileSync(join(dir, 'auth.json'), 'utf8')).toBe('{"token":"x"}');
    expect(readFileSync(join(dir, 'config.toml'), 'utf8')).toBe('model = "gpt-6.1"');
    const atrHooks = JSON.parse(readFileSync(join(dir, 'hooks.json'), 'utf8'));
    expect(Object.keys(atrHooks.hooks)).toContain('PermissionRequest');

    // 幂等:再 build 一次 hooks.json mtime 不变
    const m1 = statSync(join(dir, 'hooks.json')).mtimeMs;
    await new Promise((r) => setTimeout(r, 10));
    buildCodexHomeMirror({ mirrorBaseDir: mirrorBase, realCodexHome: real, cwd: '/tmp/proj a' });
    expect(statSync(join(dir, 'hooks.json')).mtimeMs).toBe(m1);
  });

  it('真实 .codex 不存在 → 仅 hooks.json,不报错', () => {
    const dir = buildCodexHomeMirror({
      mirrorBaseDir: join(base, 'mirror2'),
      realCodexHome: join(base, 'no-such-codex'),
      cwd: '/x',
    });
    expect(JSON.parse(readFileSync(join(dir, 'hooks.json'), 'utf8')).hooks).toBeDefined();
  });
});

// ──────────────── trust ────────────────

describe('trust', () => {
  it('computeHookTrustHash:sha256 前缀 + 事件间不同 + 同输入稳定', () => {
    const h1 = computeHookTrustHash('pre_tool_use');
    expect(h1).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(computeHookTrustHash('pre_tool_use')).toBe(h1);
    expect(computeHookTrustHash('permission_request')).not.toBe(h1);
  });

  it('trustStateKey 格式:<hooks.json 路径>:<event_snake>:0:0', () => {
    expect(trustStateKey('/m/hooks.json', 'pre_tool_use')).toBe(
      '/m/hooks.json:pre_tool_use:0:0',
    );
  });

  it('grant → read:未授权 → 一键授权 → trusted;保留用户其余内容', () => {
    const home = join(base, 'home2');
    mkdirSync(join(home, '.codex'), { recursive: true });
    const configToml = join(home, '.codex', 'config.toml');
    writeFileSync(
      configToml,
      '# 用户注释\nmodel = "gpt-6.1"\n\n[mcp_servers.ctx]\ncommand = "npx"\n',
    );
    const hooksJsonPath = '/mirror/x/hooks.json';

    expect(readCodexTrustStatus(configToml, hooksJsonPath).status).toBe('untrusted');

    const count = grantCodexTrust(configToml, hooksJsonPath);
    expect(count).toBe(CODEX_HOOK_EVENTS.length);
    expect(readCodexTrustStatus(configToml, hooksJsonPath)).toMatchObject({
      status: 'trusted',
      matched: CODEX_HOOK_EVENTS.length,
    });

    const out = readFileSync(configToml, 'utf8');
    expect(out).toContain('# 用户注释');
    expect(out).toContain('model = "gpt-6.1"');
    expect(out).toContain(
      `[hooks.state."/mirror/x/hooks.json:pre_tool_use:0:0"]`,
    );

    // 幂等:再次 grant 不产生重复段
    grantCodexTrust(configToml, hooksJsonPath);
    const out2 = readFileSync(configToml, 'utf8');
    expect(out2.match(/\[hooks\.state\."/g)!.length).toBe(CODEX_HOOK_EVENTS.length);
    expect(readCodexTrustStatus(configToml, hooksJsonPath).status).toBe('trusted');
  });

  it('grant:已有段但无 trusted_hash 行(enabled=false 场景)→ 插入不重复', () => {
    const home = join(base, 'home3');
    mkdirSync(home, { recursive: true });
    const configToml = join(home, 'config.toml');
    const hooksJsonPath = '/m2/hooks.json';
    grantCodexTrust(configToml, hooksJsonPath);
    // 模拟 codex 写出的 enabled=false 无 hash 段
    let text = readFileSync(configToml, 'utf8').replace(
      /\[hooks\.state\."\/m2\/hooks\.json:stop:0:0"\]\nenabled = true\ntrusted_hash = "[^"]*"/,
      '[hooks.state."/m2/hooks.json:stop:0:0"]\nenabled = false',
    );
    writeFileSync(configToml, text);
    expect(readCodexTrustStatus(configToml, hooksJsonPath).status).toBe('untrusted');
    grantCodexTrust(configToml, hooksJsonPath);
    text = readFileSync(configToml, 'utf8');
    expect((text.match(/\[hooks\.state\./g) ?? []).length).toBe(CODEX_HOOK_EVENTS.length);
    expect(readCodexTrustStatus(configToml, hooksJsonPath).status).toBe('trusted');
  });
});
