/**
 * settings-builder 单元测试
 *
 * 重点:hook 命令的网络行为——用户 shell 常带 http_proxy(见 CLAUDE.md 环境注意),
 * curl 不绕过代理时 loopback 请求会被代理拦截(实测稳定 503),backend 永远收不到
 * hook 事件,且每次工具调用的 PreToolUse/PostToolUse 都被拖慢甚至挂到超时。
 */

import { describe, it, expect } from 'vitest';
import {
  buildHooksConfig,
  buildClaudeSettings,
  DEFAULT_CLAUDE_CODE_EVENTS,
} from './settings-builder.js';

describe('buildHooksConfig - hook 命令健壮性', () => {
  it("hook 命令必须带 --noproxy '*' 绕过 http_proxy", () => {
    const hooks = buildHooksConfig(3000) as Record<
      string,
      Array<{ hooks: Array<{ command: string }> }>
    >;

    // 所有事件的所有 handler 共用同一条命令,抽查全部事件
    for (const [event, groups] of Object.entries(hooks)) {
      for (const group of groups) {
        for (const handler of group.hooks) {
          expect(
            handler.command,
            `${event} 的 hook 命令需要 --noproxy`,
          ).toContain(`--noproxy '*'`);
        }
      }
    }
  });

  it('hook 命令必须带 --max-time,防止代理/网络挂起拖死工具调用', () => {
    const hooks = buildHooksConfig(3000) as Record<
      string,
      Array<{ hooks: Array<{ command: string }> }>
    >;

    for (const [event, groups] of Object.entries(hooks)) {
      for (const group of groups) {
        for (const handler of group.hooks) {
          expect(handler.command, `${event} 的 hook 命令需要 --max-time`).toMatch(
            /--max-time \d+/,
          );
        }
      }
    }
  });

  it('hook URL 指向对应端口的 loopback /api/hook', () => {
    const hooks = buildHooksConfig(4900) as Record<
      string,
      Array<{ hooks: Array<{ command: string }> }>
    >;
    const cmd = hooks['PreToolUse'][0].hooks[0].command;
    expect(cmd).toContain('http://127.0.0.1:4900/api/hook');
  });
});

describe('buildClaudeSettings - 与用户 settings 合并', () => {
  it('无 existing 时只含 hooks', () => {
    const settings = buildClaudeSettings(3000, DEFAULT_CLAUDE_CODE_EVENTS);
    expect(Object.keys(settings)).toEqual(['hooks']);
  });

  it('existing 的非 hooks 字段保留', () => {
    const settings = buildClaudeSettings(
      3000,
      DEFAULT_CLAUDE_CODE_EVENTS,
      { model: 'opus', env: { FOO: '1' }, statusLine: { type: 'command', command: 'x' } },
    ) as { model: string; env: unknown; statusLine: unknown };
    expect(settings.model).toBe('opus');
    expect(settings.env).toEqual({ FOO: '1' });
    expect(settings.statusLine).toEqual({ type: 'command', command: 'x' });
  });

  it('同名 hook 事件:用户条目保留在前,atr 条目追加在后(条目级合并)', () => {
    const userEntry = { matcher: 'Bash', hooks: [{ type: 'command', command: 'echo old' }] };
    const settings = buildClaudeSettings(
      3000,
      DEFAULT_CLAUDE_CODE_EVENTS,
      { hooks: { PreToolUse: [userEntry] } },
    ) as { hooks: Record<string, unknown[]> };

    const merged = settings.hooks['PreToolUse']!;
    // 用户条目不丢
    expect(merged[0]).toEqual(userEntry);
    // atr 的 curl 条目追加,指向本实例端口
    expect(merged).toHaveLength(2);
    const atrCmd = (merged[1] as { hooks: Array<{ command: string }> }).hooks[0]!.command;
    expect(atrCmd).toContain('127.0.0.1:3000/api/hook');
  });

  it('用户独有事件(atri 未注册)原样保留', () => {
    const userEntry = { matcher: '', hooks: [{ type: 'command', command: 'echo mine' }] };
    const settings = buildClaudeSettings(
      3000,
      DEFAULT_CLAUDE_CODE_EVENTS,
      { hooks: { PostToolBatch: [userEntry] } },
    ) as { hooks: Record<string, unknown[]> };
    expect(settings.hooks['PostToolBatch']).toEqual([userEntry]);
  });

  it('用户 hooks 字段类型异常时安全回退为纯 atr hooks', () => {
    const settings = buildClaudeSettings(3000, DEFAULT_CLAUDE_CODE_EVENTS, {
      hooks: 'not-an-object',
    }) as { hooks: Record<string, unknown[]> };
    expect(settings.hooks['PreToolUse']).toEqual(
      (buildHooksConfig(3000) as Record<string, unknown>)['PreToolUse'],
    );
  });
});
