/**
 * ClaudeCodeIntegration 组合层测试
 *
 * detect 的 viaShellFallback 分支(shell 函数 fallback 场景下 command 是
 * $SHELL,无法从命令名识别 claude)与 prepareSpawn 的 env 注入通道。
 *
 * 0.18 起(ADR-002):镜像按项目 cwd 命名、同项目多实例共享、实例退出不删;
 * prepareSpawn 额外注入 ATR_HOOK_PORT(hooks URL 的 ${ATR_HOOK_PORT:-1}
 * 运行期解引用);事件子开关改为 onHookPayload 运行时过滤。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ClaudeCodeIntegration, CLAUDE_CONFIG_DIR_ENV, ATR_HOOK_PORT_ENV } from './index.js';

describe('ClaudeCodeIntegration.detect - viaShellFallback', () => {
  const mod = () => new ClaudeCodeIntegration();
  const ctx = { command: 'x', args: [] as string[], port: 1, cwd: '/tmp' };

  it('claude 命名照旧命中', () => {
    expect(mod().detect({ ...ctx, command: 'claude' })).toBe(true);
  });

  it('fallback 场景:command 是 $SHELL 但 viaShellFallback=true → 命中(zclaude 函数)', () => {
    expect(
      mod().detect({ ...ctx, command: '/usr/bin/zsh', args: ['-ic', "'zclaude'"], viaShellFallback: true }),
    ).toBe(true);
  });

  it('非 fallback 的裸 shell → 不命中(atr bash 里手动敲 claude 不注入)', () => {
    expect(mod().detect({ ...ctx, command: 'bash' })).toBe(false);
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

  function spawn(cwd: string, port = 41237) {
    const mod = new ClaudeCodeIntegration({ settingsBaseDir: base });
    return {
      mod,
      aug: mod.prepareSpawn({ command: 'claude', args: [], port, cwd }),
    };
  }

  it('注入 CLAUDE_CONFIG_DIR 与 ATR_HOOK_PORT 两个 env,不再走 --settings 参数', () => {
    const { aug } = spawn('/mnt/d/github/observer');
    expect(aug?.extraEnv?.[CLAUDE_CONFIG_DIR_ENV]).toBeDefined();
    expect(aug?.extraEnv?.[ATR_HOOK_PORT_ENV]).toBe('41237');
    expect(aug?.extraArgs).toBeUndefined();
  });

  it('镜像位于 <baseDir>/claude-code/<escapedCwd>/(按 integration id 分顶层)', () => {
    const { aug } = spawn('/mnt/d/github/observer');
    expect(aug?.extraEnv?.[CLAUDE_CONFIG_DIR_ENV]).toBe(
      join(base, 'claude-code', '-mnt-d-github-observer'),
    );
  });

  it('镜像 settings.json 的 hooks 端口走 ${ATR_HOOK_PORT:-1}(内容与实例无关)', () => {
    const { aug } = spawn('/mnt/d/github/observer');
    const dir = aug?.extraEnv?.[CLAUDE_CONFIG_DIR_ENV]!;
    const settings = JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf-8')) as {
      hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>>;
    };
    // 用户本机已有 hooks(如 claude-sound)会透传合并进镜像,ATR 注入项未必在
    // 数组 [0]——在整个 PreToolUse 里找 ATR 注入项断言,不依赖顺序
    const allCmds = (settings.hooks['PreToolUse'] ?? []).flatMap((g) =>
      g.hooks.map((h) => h.command),
    );
    expect(allCmds.some((c) => c.includes('${ATR_HOOK_PORT:-1}'))).toBe(true);
    // 任何 hook 都不得硬编码实例端口(镜像内容与实例无关,这是共享的前提)
    for (const c of allCmds) {
      expect(c).not.toMatch(/127\.0\.0\.1:\d{4,5}\/api\/hook/);
    }
  });

  it('同项目不同端口共享同一镜像(目录名不含端口)', () => {
    const { aug: a1 } = spawn('/mnt/d/github/observer', 11111);
    const { aug: a2 } = spawn('/mnt/d/github/observer', 22222);
    expect(a1?.extraEnv?.[CLAUDE_CONFIG_DIR_ENV]).toBe(a2?.extraEnv?.[CLAUDE_CONFIG_DIR_ENV]);
    // ATR_HOOK_PORT 各自注入
    expect(a1?.extraEnv?.[ATR_HOOK_PORT_ENV]).toBe('11111');
    expect(a2?.extraEnv?.[ATR_HOOK_PORT_ENV]).toBe('22222');
  });

  it('shutdown 不删除镜像(共享生命周期,启动幂等重建)', () => {
    const { mod, aug } = spawn('/mnt/d/github/observer');
    const dir = aug?.extraEnv?.[CLAUDE_CONFIG_DIR_ENV]!;
    mod.shutdown();
    expect(existsSync(dir)).toBe(true);
  });
});

describe('ClaudeCodeIntegration.onHookPayload - 事件运行时过滤', () => {
  it('默认开关:审批/工具/turn/会话事件放行;user_prompt 随 approvals 兜底放行(复刻旧版注册矩阵)', () => {
    const mod = new ClaudeCodeIntegration();
    expect(
      mod.onHookPayload({ hook_event_name: 'PermissionRequest', tool_name: 'Bash' }),
    ).toHaveLength(1);
    // 旧版 userPrompts=false 但 approvals=true 时 UserPromptSubmit 仍注册
    // (SessionController 用它清 stuck pending;push 层不带原文)
    expect(
      mod.onHookPayload({ hook_event_name: 'UserPromptSubmit', prompt: 'hi' }),
    ).toHaveLength(1);
  });

  it('approvals=false 拦 approval_pending,toolProgress 事件(含附带 approval_resolved)放行', () => {
    const mod = new ClaudeCodeIntegration({
      events: { approvals: false, toolProgress: true, turnLifecycle: true, sessionLifecycle: true, userPrompts: false },
    });
    expect(
      mod.onHookPayload({ hook_event_name: 'PermissionRequest', tool_name: 'Bash' }),
    ).toHaveLength(0);
    // PostToolUse → tool_finished + approval_resolved:旧版该 hook 归 toolProgress
    // 注册,approvals 关闭不影响附带事件
    const events = mod.onHookPayload({ hook_event_name: 'PostToolUse', tool_use_id: 't1' });
    expect(events.map((e) => e.kind)).toEqual(['tool_finished', 'approval_resolved']);
  });

  it('userPrompts=true 放行 prompt 原文', () => {
    const mod = new ClaudeCodeIntegration({
      events: { approvals: true, toolProgress: true, turnLifecycle: true, sessionLifecycle: true, userPrompts: true },
    });
    const events = mod.onHookPayload({ hook_event_name: 'UserPromptSubmit', prompt: 'hi' });
    expect(events).toEqual([{ kind: 'user_prompt', text: 'hi' }]);
  });
});
