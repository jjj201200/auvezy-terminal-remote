/**
 * Claude Code settings JSON 生成
 *
 * 给 Claude Code 注入 hook 配置,把多个生命周期事件 POST 到本地 /api/hook。
 * 生成的 settings.json 落在按项目命名的镜像目录内(见 config-dir-mirror.ts),
 * 经 PTY env CLAUDE_CONFIG_DIR 生效。
 *
 * 0.18 起(ADR-002)两个关键约束:
 *  - **端口走 env**:镜像被同项目多实例共享,settings 内容必须与实例无关——
 *    URL 写死 `${ATR_HOOK_PORT:-1}`,实例端口经 PTY env ATR_HOOK_PORT 注入,
 *    未注入(不经 atr 的普通终端)时打 127.0.0.1:1 即刻 connection refused,
 *    无感开销。
 *  - **固定全事件注册**:事件子开关(用户设置面板的 perModule events)不再
 *    影响生成,改由 ClaudeCodeIntegration.onHookPayload 按事件类别运行时过滤
 *    ——设置面板语义不变,镜像内容恒定。
 *
 * 用户原有 settings 仍合并保留;同名 hook 事件按条目级 append,用户条目在前。
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { logger } from '../../logger/logger.js';

/**
 * 各类事件的子开关。设置面板的 perModule['claude-code'].events 字段。
 *
 * 0.18 起语义为**运行时过滤**(onHookPayload 按类别丢弃事件),不再影响
 * settings 生成——镜像共享后 settings 只能有一份,无法按实例定制。
 *
 * 各开关相互独立,按事件语义归属拆分:
 *  - approvals:approval_pending / approval_resolved 两类纯审批信号
 *  - toolProgress:tool_started / tool_finished,完整工具生命周期
 *  - turnLifecycle:turn_ended / turn_failed
 *  - sessionLifecycle:session_event
 *  - userPrompts:user_prompt;默认 false 防 Web Push 带出 prompt 原文
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
 * 生成全量事件的 hooks JSON 节点(端口经 ATR_HOOK_PORT env 解引用)
 *
 * 全部 hook 都指向同一个本地 endpoint;后端 HookManager 根据 payload 的
 * hook_event_name 字段路由。
 *
 * shell 展开语义:hooks 命令由 claude 以 sh -c 执行、继承 PTY env,
 * `${ATR_HOOK_PORT:-1}` 在 atr 实例内展开为实例端口,未注入时取默认 1
 * (loopback :1 无监听,curl 立即 ECONNREFUSED,不等待超时)。
 */
export function buildHooksConfig(): Record<string, unknown> {
  // 注意:此处是普通单引号字符串,${} 为字面量(端口由 hooks 执行期的 sh 展开)
  const hookUrl = 'http://127.0.0.1:${ATR_HOOK_PORT:-1}/api/hook';
  // --noproxy '*':用户 shell 常带 http_proxy,curl 不绕过时 loopback 请求会被
  //   代理拦截(实测稳定 503),backend 永远收不到 hook 事件,且阻塞工具调用
  // --max-time 2:hook 是 fire-and-forget 通知,网络路径挂起时宁可丢弃也不拖慢
  //   agent 的每次 PreToolUse/PostToolUse(否则单次工具调用可卡到 hook 超时)
  const hookCommand = `curl -s --noproxy '*' --max-time 2 -X POST ${hookUrl} -H 'Content-Type: application/json' -d @-`;
  const handler = { type: 'command', command: hookCommand };

  // 同一 endpoint 注册多个事件:每个事件一个 matcher 组(matcher 留空 = 命中所有)
  // matcher 文档说省略或 "" 都视为 "命中所有",这里用空字符串保持显式
  const allMatcher = [{ matcher: '', hooks: [handler] }];

  return {
    Notification: [{ matcher: 'permission_prompt', hooks: [handler] }],
    PermissionRequest: allMatcher,
    PreToolUse: allMatcher,
    PostToolUse: allMatcher,
    PostToolUseFailure: allMatcher,
    Stop: allMatcher,
    StopFailure: allMatcher,
    SessionStart: allMatcher,
    SessionEnd: allMatcher,
    PreCompact: allMatcher,
    PostCompact: allMatcher,
    CwdChanged: allMatcher,
    // 旧版按 userPrompts/approvals 开关条件注册;镜像共享后固定注册,
    // userPrompts 关闭时由运行时过滤丢弃 prompt 原文
    UserPromptSubmit: allMatcher,
  };
}

/**
 * 完整 settings 文件构造(与用户原 settings 合并)
 *
 * hooks 合并粒度是**条目级 append**:用户在每个事件下的 hook 条目全部保留,
 * atr 的 curl 条目追加在其后。事件级整体覆盖会把用户自己的 hooks
 * (如 ghost-probe / detect-ghost-tool-call)在 atr 注册的同名事件下全部顶掉,
 * 镜像 settings.json 因此"丢配置"。
 *
 * @param existing 用户已有 settings(如 --settings 参数提取的内容;
 *   不传时由 config-dir-mirror 自动读 ~/.claude/settings.json 合并)
 */
export function buildClaudeSettings(
  existing?: Record<string, unknown>,
): Record<string, unknown> {
  const ourHooks = buildHooksConfig();

  if (!existing) return { hooks: ourHooks };

  const existingHooks =
    existing['hooks'] && typeof existing['hooks'] === 'object'
      ? (existing['hooks'] as Record<string, unknown>)
      : {};

  const mergedHooks: Record<string, unknown> = { ...existingHooks };
  for (const [event, entries] of Object.entries(ourHooks)) {
    const theirs = mergedHooks[event];
    mergedHooks[event] =
      Array.isArray(theirs) && Array.isArray(entries)
        ? [...theirs, ...entries]
        : entries;
  }
  const overlapped = Object.keys(ourHooks).filter((k) => k in existingHooks);
  if (overlapped.length > 0) {
    logger.info(
      { overlapped },
      '用户已有同名 hook 事件,atr 条目追加在用户条目之后(双方都执行)',
    );
  }

  return { ...existing, hooks: mergedHooks };
}

/** 读用户 ~/.claude/settings.json;不存在/损坏返回 undefined(按全新生成) */
export function readUserSettings(realConfigDir: string): Record<string, unknown> | undefined {
  const path = join(realConfigDir, 'settings.json');
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>;
  } catch (err) {
    logger.warn({ err, path }, '用户 claude settings.json 解析失败,按无既有配置处理');
    return undefined;
  }
}
