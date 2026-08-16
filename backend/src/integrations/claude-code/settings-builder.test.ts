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

  it('existing 的非 hooks 字段保留,同名 hook 事件被覆盖', () => {
    const settings = buildClaudeSettings(
      3000,
      DEFAULT_CLAUDE_CODE_EVENTS,
      {
        model: 'opus',
        hooks: {
          PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo old' }] }],
        },
      },
    ) as { model: string; hooks: Record<string, unknown> };

    expect(settings.model).toBe('opus');
    // 同名事件整体替换为 atr 的 hook
    expect(settings.hooks['PreToolUse']).toEqual(
      (buildHooksConfig(3000) as Record<string, unknown>)['PreToolUse'],
    );
  });
});
