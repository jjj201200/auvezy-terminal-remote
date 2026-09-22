/**
 * settings-builder 单元测试
 *
 * 重点:hook 命令的网络行为——用户 shell 常带 http_proxy(见 CLAUDE.md 环境注意),
 * curl 不绕过代理时 loopback 请求会被代理拦截(实测稳定 503),backend 永远收不到
 * hook 事件,且每次工具调用的 PreToolUse/PostToolUse 都被拖慢甚至挂到超时。
 *
 * 0.18 起 hooks 与实例端口解耦(ADR-002):镜像按项目命名被同项目多实例共享,
 * settings.json 不能内嵌端口——URL 写 ${ATR_HOOK_PORT:-1},端口经 PTY env 注入,
 * 未注入时打 :1 即刻 connection refused。事件固定全注册,实例级开关由
 * onHookPayload 运行时过滤。
 */

import { describe, it, expect } from 'vitest';
import {
  buildHooksConfig,
  buildClaudeSettings,
} from './settings-builder.js';

/** 所有事件所有 handler 的 command 抽平(断言辅助) */
function allCommands(hooks: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const [event, groups] of Object.entries(hooks)) {
    for (const group of groups as Array<{ hooks: Array<{ command: string }> }>) {
      for (const handler of group.hooks) out.push(handler.command);
    }
  }
  return out;
}

describe('buildHooksConfig - hook 命令健壮性', () => {
  it("hook 命令必须带 --noproxy '*' 绕过 http_proxy", () => {
    const hooks = buildHooksConfig() as Record<string, unknown>;
    for (const cmd of allCommands(hooks)) {
      expect(cmd).toContain(`--noproxy '*'`);
    }
  });

  it('hook 命令必须带 --max-time,防止代理/网络挂起拖死工具调用', () => {
    const hooks = buildHooksConfig() as Record<string, unknown>;
    for (const cmd of allCommands(hooks)) {
      expect(cmd).toMatch(/--max-time \d+/);
    }
  });
});

describe('buildHooksConfig - 端口走 env(与实例解耦)', () => {
  it('URL 写 ${ATR_HOOK_PORT:-1}:端口运行期由 PTY env 注入', () => {
    const hooks = buildHooksConfig() as Record<string, unknown>;
    for (const cmd of allCommands(hooks)) {
      expect(cmd).toContain('http://127.0.0.1:${ATR_HOOK_PORT:-1}/api/hook');
    }
  });

  it('不得出现硬编码端口号(镜像需跨实例共享,内容与实例无关)', () => {
    const hooks = buildHooksConfig() as Record<string, unknown>;
    for (const cmd of allCommands(hooks)) {
      expect(cmd).not.toMatch(/127\.0\.0\.1:\d{4,5}\/api\/hook/);
    }
  });
});

describe('buildHooksConfig - 固定全事件注册', () => {
  it('所有生命周期事件无条件注册(实例级开关在 onHookPayload 过滤)', () => {
    const hooks = buildHooksConfig() as Record<string, unknown>;
    const expected = [
      'Notification',
      'PermissionRequest',
      'PreToolUse',
      'PostToolUse',
      'PostToolUseFailure',
      'Stop',
      'StopFailure',
      'SessionStart',
      'SessionEnd',
      'PreCompact',
      'PostCompact',
      'CwdChanged',
      // 旧版按 userPrompts/approvals 开关才注册;共享镜像下固定注册
      'UserPromptSubmit',
    ];
    for (const ev of expected) {
      expect(hooks[ev], `事件 ${ev} 应注册`).toBeDefined();
    }
  });
});

describe('buildClaudeSettings - 与用户 settings 合并', () => {
  it('无 existing 时只含 hooks', () => {
    const settings = buildClaudeSettings();
    expect(Object.keys(settings)).toEqual(['hooks']);
  });

  it('existing 的非 hooks 字段保留', () => {
    const settings = buildClaudeSettings({
      model: 'opus',
      env: { FOO: '1' },
      statusLine: { type: 'command', command: 'x' },
    }) as { model: string; env: unknown; statusLine: unknown };
    expect(settings.model).toBe('opus');
    expect(settings.env).toEqual({ FOO: '1' });
    expect(settings.statusLine).toEqual({ type: 'command', command: 'x' });
  });

  it('同名 hook 事件:用户条目保留在前,atr 条目追加在后(条目级合并)', () => {
    const userEntry = { matcher: 'Bash', hooks: [{ type: 'command', command: 'echo old' }] };
    const settings = buildClaudeSettings({
      hooks: { PreToolUse: [userEntry] },
    }) as { hooks: Record<string, unknown[]> };

    const merged = settings.hooks['PreToolUse']!;
    // 用户条目不丢
    expect(merged[0]).toEqual(userEntry);
    // atr 的 curl 条目追加,端口走 env
    expect(merged).toHaveLength(2);
    const atrCmd = (merged[1] as { hooks: Array<{ command: string }> }).hooks[0]!.command;
    expect(atrCmd).toContain('${ATR_HOOK_PORT:-1}');
  });

  it('用户独有事件(atri 未注册)原样保留', () => {
    const userEntry = { matcher: '', hooks: [{ type: 'command', command: 'echo mine' }] };
    const settings = buildClaudeSettings({
      hooks: { PostToolBatch: [userEntry] },
    }) as { hooks: Record<string, unknown[]> };
    expect(settings.hooks['PostToolBatch']).toEqual([userEntry]);
  });

  it('用户 hooks 字段类型异常时安全回退为纯 atr hooks', () => {
    const settings = buildClaudeSettings({ hooks: 'not-an-object' }) as {
      hooks: Record<string, unknown[]>;
    };
    expect(settings.hooks['PreToolUse']).toEqual(
      (buildHooksConfig() as Record<string, unknown>)['PreToolUse'],
    );
  });
});
