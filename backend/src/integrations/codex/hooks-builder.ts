/**
 * Codex hooks.json 生成
 *
 * 给 Codex CLI 注入 hook 配置,把生命周期事件 POST 到本地 /api/hook。
 * 生成的 hooks.json 落在按项目命名的 CODEX_HOME 镜像目录内(见
 * codex-home-mirror.ts),经 PTY env CODEX_HOME 生效。
 *
 * 格式契约(rust-v0.162.1 config/src/hook_config.rs,与 Claude settings 的
 * hooks 段刻意兼容——引擎即 ClaudeHooksEngine):
 *  - 顶层 `{ description?, hooks: { <PascalCase 事件名>: MatcherGroup[] } }`
 *  - MatcherGroup `{ matcher?: string|null, hooks: HookHandlerConfig[] }`
 *  - command handler `{ type: "command", command, timeout?, async?, ... }`
 *    (serde 键是 "timeout",不是 rust 字段名 timeout_sec)
 *
 * 与 claude 集成同款两个约束:
 *  - 端口走 env:URL 写死 `${ATR_HOOK_PORT:-1}`,实例端口运行期展开,镜像内容
 *    与实例无关、同项目多实例共享
 *  - 固定全事件注册:事件子开关由 CodexIntegration.onHookPayload 运行时过滤
 *
 * trust 注意:hooks.json 内容属于 hook 身份(trust 哈希的输入,见 trust.ts),
 * **任何字段改动都会让已授权的 trust 失效**——修改 command/timeout/事件集
 * 时必须考虑用户需要重新一键授权。
 */

/**
 * 各类事件的子开关(与 claude-code 的 5 类同构,设置面板
 * perModule['codex'].events 字段)
 */
export interface CodexEventToggles {
  approvals: boolean;
  toolProgress: boolean;
  turnLifecycle: boolean;
  sessionLifecycle: boolean;
  userPrompts: boolean;
}

export const DEFAULT_CODEX_EVENTS: CodexEventToggles = {
  approvals: true,
  toolProgress: true,
  turnLifecycle: true,
  sessionLifecycle: true,
  userPrompts: false,
};

/** hook 超时(秒)。短超时:hook 是 fire-and-forget 通知,宁可丢弃不拖慢工具调用
 * (尤其 PermissionRequest——它在审批弹框前同步跑,超时即弃权走正常审批流) */
const HOOK_TIMEOUT_SEC = 3;

/** hook shell 命令(与 claude 集成完全同款;${} 为字面量,执行期 shell 展开) */
export const CODEX_HOOK_COMMAND =
  `curl -s --noproxy '*' --max-time 2 -X POST http://127.0.0.1:\${ATR_HOOK_PORT:-1}/api/hook -H 'Content-Type: application/json' -d @-`;

/**
 * atr 注入的事件集(PascalCase 键,与 HookEventsToml serde rename 一致)
 *
 * 一期不注 SubagentStart/SubagentStop(事件模型里无对应消费者)。
 */
export const CODEX_HOOK_EVENTS = [
  'PermissionRequest',
  'PreToolUse',
  'PostToolUse',
  'Stop',
  'Interrupt',
  'SessionStart',
  'SessionEnd',
  'UserPromptSubmit',
  'PreCompact',
  'PostCompact',
] as const;

export type CodexHookEventName = (typeof CODEX_HOOK_EVENTS)[number];

/** 事件 PascalCase 名 → state key 用的 snake_case(哈希输入同用) */
const EVENT_SNAKE: Record<CodexHookEventName, string> = {
  PermissionRequest: 'permission_request',
  PreToolUse: 'pre_tool_use',
  PostToolUse: 'post_tool_use',
  Stop: 'stop',
  Interrupt: 'interrupt',
  SessionStart: 'session_start',
  SessionEnd: 'session_end',
  UserPromptSubmit: 'user_prompt_submit',
  PreCompact: 'pre_compact',
  PostCompact: 'post_compact',
};

export function eventSnakeCase(event: CodexHookEventName): string {
  return EVENT_SNAKE[event];
}

/** 单个 handler 的 JSON 形态(timeout 显式:参与 trust 哈希,须恒定) */
export function codexHookHandler(): Record<string, unknown> {
  return {
    type: 'command',
    command: CODEX_HOOK_COMMAND,
    timeout: HOOK_TIMEOUT_SEC,
  };
}

/**
 * 生成完整 hooks.json 内容(对象形态,由调用方序列化落盘)
 *
 * matcher 用空串(= 命中所有);空串参与 trust 哈希身份,不可改成省略
 * (省略 = None,哈希身份不同)。
 */
export function buildCodexHooksJson(): Record<string, unknown> {
  const hooks: Record<string, unknown> = {};
  for (const event of CODEX_HOOK_EVENTS) {
    hooks[event] = [{ matcher: '', hooks: [codexHookHandler()] }];
  }
  return {
    description: 'auvezy terminal remote: event callbacks to local /api/hook',
    hooks,
  };
}
