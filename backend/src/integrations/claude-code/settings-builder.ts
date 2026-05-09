/**
 * Claude Code settings JSON 生成 + 落盘
 *
 * 给 Claude Code 注入 hook 配置,把多个生命周期事件 POST 到本地 /api/hook。
 * 文件路径:~/.atr/settings/<port>.json,作为 `claude --settings <path>` 参数。
 *
 * 与原 backend/src/config.ts 的 createClaudeSettings 相比的扩展:
 *  - 不再只挂 Notification + PreToolUse(AskUserQuestion);现在按 ClaudeCodeEventToggles
 *    选择性注册多个事件,默认全部启用
 *  - 用户原有 settings 仍合并保留;同名 hook 事件被覆盖时打 warn
 *
 * 文件 IO 与原 saveClaudeSettings 行为一致(同步、0o600、目录 0o700)。
 */

import { existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import { ATR_DATA_DIR, SETTINGS_DIRNAME } from 'auvezy-terminal-remote-shared';
import { logger } from '../../logger/logger.js';

/**
 * 各类事件的子开关。设置面板的 perModule['claude-code'].events 字段。
 *
 * 注:`approvals` 同时管 Notification(permission_prompt) + PermissionRequest +
 * PostToolUse + PostToolUseFailure(后两者用于把"等待审批"翻回"运行中")。
 * 关掉 approvals 后状态机会失去"审批结束"信号,审批 bug 可能复现——这是一个
 * 整体能力,不允许只开一半。
 *
 * `userPrompts` 默认 false 防止 Web Push 把用户输入原文带出主机(隐私顾虑);
 * 用户可在设置中显式开启。
 */
export interface ClaudeCodeEventToggles {
  approvals: boolean;
  toolProgress: boolean;
  turnLifecycle: boolean;
  sessionLifecycle: boolean;
  userPrompts: boolean;
}

export const DEFAULT_CLAUDE_CODE_EVENTS: ClaudeCodeEventToggles = {
  approvals: true,
  toolProgress: true,
  turnLifecycle: true,
  sessionLifecycle: true,
  userPrompts: false,
};

/**
 * 把 toggle 集合转成 Claude Code 的 hooks JSON 节点
 *
 * 全部 hook 都指向同一个本地 endpoint;后端 HookManager 根据 payload 的
 * hook_event_name 字段路由。
 */
export function buildHooksConfig(
  port: number,
  toggles: ClaudeCodeEventToggles = DEFAULT_CLAUDE_CODE_EVENTS,
): Record<string, unknown> {
  const hookUrl = `http://127.0.0.1:${port}/api/hook`;
  const hookCommand = `curl -s -X POST ${hookUrl} -H 'Content-Type: application/json' -d @-`;
  const handler = { type: 'command', command: hookCommand };

  // 同一 endpoint 注册多个事件:每个事件一个 matcher 组(matcher 留空 = 命中所有)
  // matcher 文档说省略或 "" 都视为 "命中所有",这里用空字符串保持显式
  const allMatcher = [{ matcher: '', hooks: [handler] }];

  const out: Record<string, unknown> = {};
  if (toggles.approvals) {
    out['Notification'] = [{ matcher: 'permission_prompt', hooks: [handler] }];
    out['PermissionRequest'] = allMatcher;
    // PostToolUse / PostToolUseFailure 是把 waiting_input 翻回 running 的关键信号
    out['PostToolUse'] = allMatcher;
    out['PostToolUseFailure'] = allMatcher;
  }
  if (toggles.toolProgress) {
    out['PreToolUse'] = allMatcher;
    // PostToolUse 已在 approvals 里注册过;若 approvals 关而 toolProgress 开,这里补
    if (!toggles.approvals) {
      out['PostToolUse'] = allMatcher;
      out['PostToolUseFailure'] = allMatcher;
    }
  }
  if (toggles.turnLifecycle) {
    out['Stop'] = allMatcher;
    out['StopFailure'] = allMatcher;
  }
  if (toggles.sessionLifecycle) {
    out['SessionStart'] = allMatcher;
    out['SessionEnd'] = allMatcher;
    out['PreCompact'] = allMatcher;
    out['PostCompact'] = allMatcher;
    out['CwdChanged'] = allMatcher;
  }
  if (toggles.userPrompts) {
    out['UserPromptSubmit'] = allMatcher;
  }
  return out;
}

/**
 * 完整 settings 文件构造(与用户原 settings 合并)
 *
 * @param port    当前实例端口
 * @param toggles 事件子开关(由 IntegrationManager 传入用户偏好)
 * @param existing 用户原有 settings(从 --settings <path> 提取的内容)
 */
export function buildClaudeSettings(
  port: number,
  toggles: ClaudeCodeEventToggles,
  existing?: Record<string, unknown>,
): Record<string, unknown> {
  const ourHooks = buildHooksConfig(port, toggles);

  if (!existing) return { hooks: ourHooks };

  const existingHooks =
    existing['hooks'] && typeof existing['hooks'] === 'object'
      ? (existing['hooks'] as Record<string, unknown>)
      : {};

  const overlapped = Object.keys(ourHooks).filter((k) => k in existingHooks);
  if (overlapped.length > 0) {
    logger.warn({ overlapped }, '用户已有同名 hook 事件被 atr 覆盖(这是必需的)');
  }

  return { ...existing, hooks: { ...existingHooks, ...ourHooks } };
}

/**
 * 落盘 settings 文件并返回绝对路径
 *
 * 同步 IO,仅启动阶段调用。文件 0o600,目录 0o700(沿用原 saveClaudeSettings)。
 */
export function saveSettingsFile(
  settings: Record<string, unknown>,
  port: number,
  baseDir?: string,
): string {
  const dir = baseDir ?? resolve(homedir(), ATR_DATA_DIR);
  const settingsDir = resolve(dir, SETTINGS_DIRNAME);

  if (!existsSync(settingsDir)) {
    mkdirSync(settingsDir, { recursive: true, mode: 0o700 });
  }

  const path = resolve(settingsDir, `${port}.json`);
  writeFileSync(path, JSON.stringify(settings, null, 2), { encoding: 'utf-8', mode: 0o600 });
  logger.info({ path, port }, 'Claude settings 已写入(integrations/claude-code)');
  return path;
}
