/**
 * Claude Code hook payload → IntegrationEvent 翻译
 *
 * 输入是 Claude Code 通过 settings hook 上报的 JSON;输出是 ATR 通用事件。
 * 模块的"领域知识"几乎全部封装在此;调用方(SessionController)只看通用事件。
 *
 * 关键映射表(对照官方文档 code.claude.com/docs/en/hooks.md):
 *
 *  hook_event_name        → IntegrationEvent
 *  ─────────────────────────────────────────────────
 *  Notification (permission_prompt) → approval_pending
 *  PermissionRequest                → approval_pending
 *  PreToolUse                       → tool_started
 *  PostToolUse                      → tool_finished(ok=true) + approval_resolved(allow)
 *  PostToolUseFailure               → tool_finished(ok=false) + approval_resolved(deny|unknown)
 *  UserPromptSubmit                 → user_prompt
 *  Stop                             → turn_ended
 *  StopFailure                      → turn_failed
 *  SessionStart / SessionEnd        → session_event(start|end)
 *  PreCompact / PostCompact         → session_event(compact_start|compact_end)
 *  CwdChanged                       → cwd_changed
 *  其它/无法识别                     → []
 *
 * 审批配对逻辑:
 *  - PermissionRequest / Notification 没有 tool_use_id(都在工具实际执行前)
 *  - PostToolUse / PostToolUseFailure 有 tool_use_id
 *  - 我们用工具名 + 占位 id 跨这两条事件配对——见 deriveApprovalId
 */

import type { IntegrationEvent } from '../types.js';
import { summarizeToolCall } from './tool-summary.js';

/** 从 message 文本末尾抠工具名(Notification 没有 tool_name 字段时兜底用) */
const TOOL_NAME_RE = /permission to use (\S+)\s*$/;

function extractToolFromMessage(message: unknown): string | null {
  if (typeof message !== 'string') return null;
  const m = TOOL_NAME_RE.exec(message);
  return m?.[1] ?? null;
}

function asString(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function asBool(v: unknown): boolean | undefined {
  return typeof v === 'boolean' ? v : undefined;
}

function asNumber(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/**
 * 派生稳定的"审批 id"
 *
 * 设计:Claude Code 不直接告诉我们"审批 X 已结束",我们靠 PostToolUse 的
 * tool_use_id 反推。但 PermissionRequest / Notification 并没有 tool_use_id。
 *
 * 规则:
 *  - 优先使用 tool_use_id;PostToolUse 一定有
 *  - 没有时退化为 `pending:<tool>:<seq>` 形式,SessionController 用工具名 + LIFO
 *    匹配(开了 N 个 Bash 审批,后到的 PostToolUse(Bash) 配最近一个)。
 */
export function deriveApprovalId(payload: Record<string, unknown>): string {
  const toolUseId = asString(payload['tool_use_id']);
  if (toolUseId) return toolUseId;
  const tool = asString(payload['tool_name']) ?? extractToolFromMessage(payload['message']) ?? 'unknown';
  return `pending:${tool}`;
}

/** 把单个 hook payload 翻译为 0..N 个 IntegrationEvent */
export function mapHookPayload(payload: unknown): IntegrationEvent[] {
  if (!payload || typeof payload !== 'object') return [];
  const p = payload as Record<string, unknown>;
  const event = asString(p['hook_event_name']);
  if (!event) return [];

  switch (event) {
    case 'Notification': {
      // 仅 permission_prompt 转成 approval_pending;其它 idle/auth 等忽略
      if (p['notification_type'] !== 'permission_prompt') return [];
      const tool =
        asString(p['tool_name']) ?? extractToolFromMessage(p['message']) ?? 'unknown_tool';
      return [
        {
          kind: 'approval_pending',
          id: deriveApprovalId(p),
          tool,
          ...(asString(p['message']) ? { detail: asString(p['message'])! } : {}),
        },
      ];
    }
    case 'PermissionRequest': {
      const tool = asString(p['tool_name']) ?? 'unknown_tool';
      const summary = summarizeToolCall(tool, p['tool_input']);
      return [
        {
          kind: 'approval_pending',
          id: deriveApprovalId(p),
          tool,
          detail: summary,
        },
      ];
    }
    case 'PreToolUse': {
      const tool = asString(p['tool_name']) ?? 'unknown_tool';
      return [
        {
          kind: 'tool_started',
          toolUseId: asString(p['tool_use_id']) ?? deriveApprovalId(p),
          tool,
          summary: summarizeToolCall(tool, p['tool_input']),
        },
      ];
    }
    case 'PostToolUse': {
      const id = asString(p['tool_use_id']) ?? deriveApprovalId(p);
      const events: IntegrationEvent[] = [
        { kind: 'tool_finished', toolUseId: id, ok: true, ...(asNumber(p['duration_ms']) !== undefined ? { durationMs: asNumber(p['duration_ms'])! } : {}) },
        { kind: 'approval_resolved', id, outcome: 'allow' },
      ];
      return events;
    }
    case 'PostToolUseFailure': {
      const id = asString(p['tool_use_id']) ?? deriveApprovalId(p);
      // 用户主动 interrupt → 视为 deny;否则当作未知失败(可能是工具内部错)
      const interrupted = asBool(p['is_interrupt']) === true;
      const events: IntegrationEvent[] = [
        {
          kind: 'tool_finished',
          toolUseId: id,
          ok: false,
          ...(asNumber(p['duration_ms']) !== undefined ? { durationMs: asNumber(p['duration_ms'])! } : {}),
          ...(asString(p['error']) ? { error: asString(p['error'])! } : {}),
        },
        { kind: 'approval_resolved', id, outcome: interrupted ? 'deny' : 'unknown' },
      ];
      return events;
    }
    case 'UserPromptSubmit': {
      const text = asString(p['prompt']);
      if (!text) return [];
      return [{ kind: 'user_prompt', text }];
    }
    case 'Stop': {
      return [
        {
          kind: 'turn_ended',
          ...(asString(p['last_assistant_message'])
            ? { lastMessage: asString(p['last_assistant_message'])! }
            : {}),
        },
      ];
    }
    case 'StopFailure': {
      return [
        {
          kind: 'turn_failed',
          errorKind: asString(p['error']) ?? 'unknown',
          ...(asString(p['error_details']) ? { detail: asString(p['error_details'])! } : {}),
        },
      ];
    }
    case 'SessionStart': {
      return [
        {
          kind: 'session_event',
          phase: 'start',
          ...(asString(p['source']) ? { detail: asString(p['source'])! } : {}),
        },
      ];
    }
    case 'SessionEnd': {
      return [
        {
          kind: 'session_event',
          phase: 'end',
          ...(asString(p['reason']) ? { detail: asString(p['reason'])! } : {}),
        },
      ];
    }
    case 'PreCompact': {
      return [
        {
          kind: 'session_event',
          phase: 'compact_start',
          ...(asString(p['trigger']) ? { detail: asString(p['trigger'])! } : {}),
        },
      ];
    }
    case 'PostCompact': {
      return [
        {
          kind: 'session_event',
          phase: 'compact_end',
          ...(asString(p['trigger']) ? { detail: asString(p['trigger'])! } : {}),
        },
      ];
    }
    case 'CwdChanged': {
      const from = asString(p['old_cwd']);
      const to = asString(p['new_cwd']);
      if (!from || !to) return [];
      return [{ kind: 'cwd_changed', from, to }];
    }
    default:
      return [];
  }
}
