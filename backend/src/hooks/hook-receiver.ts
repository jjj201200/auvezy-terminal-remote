/**
 * HookReceiver
 *
 * 接收并解析 Claude Code 触发的 Notification / PreToolUse hook payload。
 *
 * 设计：
 *  - 用 EventEmitter 解耦，调用方监听 'notification' 事件后做后续动作
 *  - 仅处理 permission_prompt（这是审批的核心信号）；其他事件忽略并打 debug 日志
 *  - 工具名提取优先级：payload.tool_name → 从 message 文本中正则匹配 → 兜底 'unknown_tool'
 *  - HTTP 路由层做 localhost-only 校验（不在本类内）
 */

import { EventEmitter } from 'node:events';
import { logger } from '../logger/logger.js';

/**
 * Claude Code hook 的原始 payload
 *
 * Claude Code 的 hook payload 结构由其自身决定，我们仅依赖必需字段。
 * 用 [key: string]: unknown 容纳未知字段保持向前兼容。
 */
export interface HookPayload {
  /** Notification 事件子类型；我们只处理 'permission_prompt' */
  notification_type?: string;
  /** Hook 事件名：'Notification' | 'PreToolUse' | ... */
  hook_event_name?: string;
  /** 显式工具名（PreToolUse 通常会有） */
  tool_name?: string;
  /** 工具调用参数（不解析） */
  tool_input?: Record<string, unknown>;
  /** 人类可读消息（Notification 通常会有） */
  message?: string;
  /** Claude session 标识 */
  session_id?: string;

  [key: string]: unknown;
}

/** 已解析后的通知信息（emit 给业务层） */
export interface HookNotification {
  /** 工具名（已尝试规范化） */
  tool: string;
  /** 显示给用户的文本 */
  message: string;
}

/** processHook 返回值 */
export type HookResult =
  | { type: 'notification'; notification: HookNotification }
  | { type: 'ignored'; reason: string };

/**
 * 从 message 末尾抽取工具名的正则
 *
 * Claude 的提示文案约定为 "...permission to use <ToolName>"
 * 例：'Claude needs your permission to use Bash' → 'Bash'
 */
const TOOL_NAME_RE = /permission to use (\S+)\s*$/;

export class HookReceiver extends EventEmitter {
  /**
   * 解析一条 hook payload
   *
   * @returns 已识别 → notification（同时 emit 'notification' 事件）；其他 → ignored
   */
  processHook(payload: HookPayload): HookResult {
    logger.info({ payload }, '收到 hook payload');

    // PreToolUse 全部忽略——审批由 Notification permission_prompt 单独处理
    if (payload.hook_event_name === 'PreToolUse') {
      return { type: 'ignored', reason: 'pre_tool_use_skipped' };
    }

    // Notification 中只处理 permission_prompt
    if (
      typeof payload.notification_type === 'string' &&
      payload.notification_type !== 'permission_prompt'
    ) {
      return { type: 'ignored', reason: `notification_type=${payload.notification_type}` };
    }

    // 工具名提取
    const tool =
      (typeof payload.tool_name === 'string' && payload.tool_name) ||
      this.extractToolFromMessage(payload.message) ||
      'unknown_tool';

    const message =
      (typeof payload.message === 'string' && payload.message) ||
      (typeof payload.tool_name === 'string'
        ? `Tool call: ${payload.tool_name}`
        : 'Approval requested (no details provided)');

    const notification: HookNotification = { tool, message };
    logger.info({ tool }, 'hook 转换为审批通知');
    this.emit('notification', notification);
    return { type: 'notification', notification };
  }

  /** 从 message 文本提取工具名 */
  private extractToolFromMessage(message: unknown): string | null {
    if (typeof message !== 'string') return null;
    const m = TOOL_NAME_RE.exec(message);
    return m ? m[1] ?? null : null;
  }
}
