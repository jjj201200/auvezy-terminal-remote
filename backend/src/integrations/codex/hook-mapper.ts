/**
 * Codex hook payload → IntegrationEvent 翻译
 *
 * 输入是 codex hooks.json 回调上报的 JSON(stdin 全量 POST 到 /api/hook);
 * 输出 ATR 通用事件。与 claude-code/hook-mapper 同构——codex 的 hooks 引擎
 * 刻意兼容 Claude 载荷形态(公共字段 session_id / cwd / hook_event_name /
 * model,各事件差异字段高度同名)。
 *
 * 映射表(rust-v0.162.1,docs/research/codex-hooks-integration.md §2-3):
 *
 *  hook_event_name   → IntegrationEvent
 *  ────────────────────────────────────────
 *  PermissionRequest → approval_pending(审批框弹出前;atr 弃权不干预)
 *  PreToolUse        → tool_started
 *  PostToolUse       → tool_finished(ok=true) + approval_resolved(allow)
 *  UserPromptSubmit  → user_prompt
 *  Stop              → turn_ended
 *  Interrupt         → turn_ended(detail: interrupted)
 *  SessionStart/End  → session_event(start|end)
 *  Pre/PostCompact   → session_event(compact_start|compact_end)
 *  其它(Subagent 系列) → [](一期无消费者)
 *
 * 审批配对:codex 的 PermissionRequest 无 tool_use_id(工具执行前),
 * PreToolUse/PostToolUse 有——与 claude 相同的"工具名 + 占位 id"策略
 * (SessionController 按工具名 LIFO 配对)。
 */

import type { IntegrationEvent } from '../types.js';
import { summarizeToolCall } from '../claude-code/tool-summary.js';
import type { CodexEventToggles } from './hooks-builder.js';

function asString(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

/** 审批占位 id:PermissionRequest 无 tool_use_id,用工具名派生(LIFO 配对) */
function deriveApprovalId(p: Record<string, unknown>): string {
  const toolUseId = asString(p['tool_use_id']);
  if (toolUseId) return toolUseId;
  const tool = asString(p['tool_name']) ?? 'unknown';
  return `pending:${tool}`;
}

/**
 * 把单个 hook payload 翻译为 0..N 个 IntegrationEvent
 *
 * codex 的 PostToolUse 含 tool_response;工具失败也走 PostToolUse(载荷无
 * 显式失败标记时按 ok=true 处理——tool_response 形态一期不深究)。
 */
export function mapCodexHookPayload(payload: unknown): IntegrationEvent[] {
  if (!payload || typeof payload !== 'object') return [];
  const p = payload as Record<string, unknown>;
  const event = asString(p['hook_event_name']);
  if (!event) return [];

  switch (event) {
    case 'PermissionRequest': {
      const tool = asString(p['tool_name']) ?? 'unknown_tool';
      const input = p['tool_input'];
      // tool_input.description 是人类可读审批理由(codex 特有),优先展示
      const desc =
        input && typeof input === 'object'
          ? asString((input as Record<string, unknown>)['description'])
          : undefined;
      const detail = desc ?? summarizeToolCall(tool, input);
      return [{ kind: 'approval_pending', id: deriveApprovalId(p), tool, detail }];
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
      return [
        { kind: 'tool_finished', toolUseId: id, ok: true },
        { kind: 'approval_resolved', id, outcome: 'allow' },
      ];
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
    case 'Interrupt': {
      // 用户打断活跃回合——按"回合结束"处理(无 last_assistant_message)
      return [{ kind: 'turn_ended' }];
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
    default:
      return []; // SubagentStart/SubagentStop 等:一期不翻译
  }
}

/**
 * 按事件子开关过滤翻译结果(与 claude-code 同款矩阵,镜像固定全事件
 * 注册、实例级开关运行时过滤)
 */
export function filterCodexEventsByToggles(
  events: readonly IntegrationEvent[],
  toggles: CodexEventToggles,
): IntegrationEvent[] {
  return events.filter((e) => {
    switch (e.kind) {
      case 'approval_pending':
        return toggles.approvals;
      case 'approval_resolved':
        return toggles.toolProgress;
      case 'tool_started':
      case 'tool_finished':
        return toggles.toolProgress;
      case 'turn_ended':
      case 'turn_failed':
        return toggles.turnLifecycle;
      case 'session_event':
        return toggles.sessionLifecycle;
      case 'user_prompt':
        return toggles.userPrompts || toggles.approvals;
      case 'turn_started':
      case 'cwd_changed':
        return true;
    }
  });
}
