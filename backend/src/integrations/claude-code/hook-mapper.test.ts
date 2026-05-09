/**
 * hook-mapper 单元测试
 *
 * 覆盖每个 hook_event_name 的典型 payload → 期望事件;以及 invalid 输入。
 */

import { describe, it, expect } from 'vitest';
import { mapHookPayload, deriveApprovalId } from './hook-mapper.js';

describe('mapHookPayload - Notification', () => {
  it('permission_prompt → approval_pending,工具名从 message 抠', () => {
    const events = mapHookPayload({
      hook_event_name: 'Notification',
      notification_type: 'permission_prompt',
      message: 'Claude needs your permission to use Bash',
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: 'approval_pending',
      tool: 'Bash',
      detail: 'Claude needs your permission to use Bash',
    });
  });

  it('其它 notification_type 忽略', () => {
    const events = mapHookPayload({
      hook_event_name: 'Notification',
      notification_type: 'idle_prompt',
      message: 'idle...',
    });
    expect(events).toEqual([]);
  });

  it('显式 tool_name 优先于 message 抠取', () => {
    const events = mapHookPayload({
      hook_event_name: 'Notification',
      notification_type: 'permission_prompt',
      tool_name: 'Edit',
      message: 'whatever',
    });
    expect(events[0]).toMatchObject({ kind: 'approval_pending', tool: 'Edit' });
  });
});

describe('mapHookPayload - PermissionRequest', () => {
  it('带 tool_input → approval_pending,detail 是工具摘要', () => {
    const events = mapHookPayload({
      hook_event_name: 'PermissionRequest',
      tool_name: 'Bash',
      tool_input: { command: 'rm -rf /tmp/x' },
    });
    expect(events[0]).toMatchObject({
      kind: 'approval_pending',
      tool: 'Bash',
      detail: 'Bash: rm -rf /tmp/x',
    });
  });
});

describe('mapHookPayload - PreToolUse / PostToolUse', () => {
  it('PreToolUse → tool_started,带 toolUseId', () => {
    const events = mapHookPayload({
      hook_event_name: 'PreToolUse',
      tool_name: 'Edit',
      tool_input: { file_path: '/a/b.ts' },
      tool_use_id: 'toolu_01',
    });
    expect(events[0]).toEqual({
      kind: 'tool_started',
      toolUseId: 'toolu_01',
      tool: 'Edit',
      summary: 'Edit /a/b.ts',
    });
  });

  it('PostToolUse → tool_finished(ok=true) + approval_resolved(allow)', () => {
    const events = mapHookPayload({
      hook_event_name: 'PostToolUse',
      tool_name: 'Bash',
      tool_use_id: 'toolu_02',
      duration_ms: 123,
    });
    expect(events).toEqual([
      { kind: 'tool_finished', toolUseId: 'toolu_02', ok: true, durationMs: 123 },
      { kind: 'approval_resolved', id: 'toolu_02', outcome: 'allow' },
    ]);
  });

  it('PostToolUseFailure(is_interrupt=true) → outcome=deny', () => {
    const events = mapHookPayload({
      hook_event_name: 'PostToolUseFailure',
      tool_name: 'Bash',
      tool_use_id: 'toolu_03',
      is_interrupt: true,
      error: 'User interrupted',
    });
    expect(events).toEqual([
      {
        kind: 'tool_finished',
        toolUseId: 'toolu_03',
        ok: false,
        error: 'User interrupted',
      },
      { kind: 'approval_resolved', id: 'toolu_03', outcome: 'deny' },
    ]);
  });

  it('PostToolUseFailure(非 interrupt) → outcome=unknown', () => {
    const events = mapHookPayload({
      hook_event_name: 'PostToolUseFailure',
      tool_name: 'Bash',
      tool_use_id: 'toolu_04',
      error: 'Exit 1',
    });
    expect(events[1]).toMatchObject({ outcome: 'unknown' });
  });
});

describe('mapHookPayload - 轮次与会话', () => {
  it('Stop → turn_ended,带 lastMessage', () => {
    const events = mapHookPayload({
      hook_event_name: 'Stop',
      last_assistant_message: '我做完了',
    });
    expect(events).toEqual([{ kind: 'turn_ended', lastMessage: '我做完了' }]);
  });

  it('StopFailure → turn_failed', () => {
    const events = mapHookPayload({
      hook_event_name: 'StopFailure',
      error: 'rate_limit',
      error_details: '429 Too Many Requests',
    });
    expect(events).toEqual([
      { kind: 'turn_failed', errorKind: 'rate_limit', detail: '429 Too Many Requests' },
    ]);
  });

  it('SessionStart → session_event(start)', () => {
    expect(
      mapHookPayload({ hook_event_name: 'SessionStart', source: 'resume' }),
    ).toEqual([{ kind: 'session_event', phase: 'start', detail: 'resume' }]);
  });

  it('PreCompact / PostCompact → session_event(compact_start/end)', () => {
    expect(mapHookPayload({ hook_event_name: 'PreCompact', trigger: 'auto' })).toEqual([
      { kind: 'session_event', phase: 'compact_start', detail: 'auto' },
    ]);
    expect(mapHookPayload({ hook_event_name: 'PostCompact', trigger: 'manual' })).toEqual([
      { kind: 'session_event', phase: 'compact_end', detail: 'manual' },
    ]);
  });

  it('CwdChanged → cwd_changed', () => {
    expect(
      mapHookPayload({
        hook_event_name: 'CwdChanged',
        old_cwd: '/a',
        new_cwd: '/a/b',
      }),
    ).toEqual([{ kind: 'cwd_changed', from: '/a', to: '/a/b' }]);
  });

  it('UserPromptSubmit → user_prompt', () => {
    expect(
      mapHookPayload({ hook_event_name: 'UserPromptSubmit', prompt: 'help' }),
    ).toEqual([{ kind: 'user_prompt', text: 'help' }]);
  });
});

describe('mapHookPayload - 边界', () => {
  it('null / undefined / 非对象 → []', () => {
    expect(mapHookPayload(null)).toEqual([]);
    expect(mapHookPayload(undefined)).toEqual([]);
    expect(mapHookPayload('str')).toEqual([]);
  });

  it('未知 hook_event_name → []', () => {
    expect(mapHookPayload({ hook_event_name: 'WeirdNewEvent' })).toEqual([]);
  });

  it('PreToolUse 没 tool_use_id → 用 deriveApprovalId 兜底', () => {
    const events = mapHookPayload({
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'ls' },
    });
    expect(events[0]).toMatchObject({ tool: 'Bash', summary: 'Bash: ls' });
    expect((events[0] as { toolUseId: string }).toolUseId).toBe('pending:Bash');
  });
});

describe('deriveApprovalId', () => {
  it('优先用 tool_use_id', () => {
    expect(deriveApprovalId({ tool_use_id: 'toolu_99', tool_name: 'Bash' })).toBe('toolu_99');
  });

  it('无 tool_use_id 时用 pending:<tool>', () => {
    expect(deriveApprovalId({ tool_name: 'Edit' })).toBe('pending:Edit');
  });

  it('啥都没 → pending:unknown', () => {
    expect(deriveApprovalId({})).toBe('pending:unknown');
  });
});
