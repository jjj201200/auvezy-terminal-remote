/**
 * HookReceiver 单测
 *
 * 覆盖：
 * - permission_prompt 类型识别
 * - PreToolUse 忽略
 * - 其他 notification_type 忽略
 * - 工具名提取三优先级（tool_name > message regex > unknown_tool）
 * - emit 'notification' 事件含 tool 与 message
 */

import { describe, it, expect, vi } from 'vitest';
import { HookReceiver } from './hook-receiver.js';

describe('HookReceiver', () => {
  it('PreToolUse 忽略', () => {
    const r = new HookReceiver();
    const onNotif = vi.fn();
    r.on('notification', onNotif);
    const result = r.processHook({ hook_event_name: 'PreToolUse', tool_name: 'Bash' });
    expect(result.type).toBe('ignored');
    expect(onNotif).not.toHaveBeenCalled();
  });

  it('非 permission_prompt 的 notification 忽略', () => {
    const r = new HookReceiver();
    const result = r.processHook({ notification_type: 'session_start' });
    expect(result.type).toBe('ignored');
    if (result.type === 'ignored') {
      expect(result.reason).toContain('session_start');
    }
  });

  it('permission_prompt 触发 emit', () => {
    const r = new HookReceiver();
    const onNotif = vi.fn();
    r.on('notification', onNotif);
    const result = r.processHook({
      notification_type: 'permission_prompt',
      tool_name: 'Bash',
      message: 'Claude needs your permission to use Bash',
    });
    expect(result.type).toBe('notification');
    expect(onNotif).toHaveBeenCalledTimes(1);
    if (result.type === 'notification') {
      expect(result.notification.tool).toBe('Bash');
      expect(result.notification.message).toContain('Bash');
    }
  });

  it('工具名优先用 tool_name 字段', () => {
    const r = new HookReceiver();
    const result = r.processHook({
      notification_type: 'permission_prompt',
      tool_name: 'Edit',
      message: 'Claude needs your permission to use Bash', // 故意冲突
    });
    if (result.type === 'notification') {
      expect(result.notification.tool).toBe('Edit'); // tool_name 胜出
    }
  });

  it('无 tool_name 时从 message 正则提取', () => {
    const r = new HookReceiver();
    const result = r.processHook({
      notification_type: 'permission_prompt',
      message: 'Claude needs your permission to use WebFetch',
    });
    if (result.type === 'notification') {
      expect(result.notification.tool).toBe('WebFetch');
    }
  });

  it('都没有 → unknown_tool', () => {
    const r = new HookReceiver();
    const result = r.processHook({
      notification_type: 'permission_prompt',
    });
    if (result.type === 'notification') {
      expect(result.notification.tool).toBe('unknown_tool');
      expect(result.notification.message).toBe('Approval requested (no details provided)');
    }
  });

  it('无 notification_type 字段也按 permission_prompt 处理（向后兼容）', () => {
    const r = new HookReceiver();
    const result = r.processHook({ tool_name: 'Bash', message: 'foo' });
    expect(result.type).toBe('notification');
  });
});
