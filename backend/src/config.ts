/**
 * 配置模块（阶段 3 子集）
 *
 * 阶段 3 仅实现：
 *  - createClaudeSettings：生成 Claude Code 的 hooks 配置（指向 /api/hook）
 *  - saveClaudeSettings：把 settings 落到 ~/.claude-remote/settings/<port>.json
 *  - extractSettingsFromArgs：从用户原始 --settings 参数中分离出 settings 内容
 *
 * 阶段 4 会扩展完整的 UserConfig / AppConfig / loadConfig / fillDefault* 等。
 *
 * Hook 触发链路：
 *   Claude 弹审批 → 执行 hook command（curl POST /api/hook）→ HookReceiver
 *
 * 为什么走文件而不是命令行内联：
 *  - claude --settings 接受文件路径或 JSON 字符串两种形式
 *  - 文件形式没有命令行长度上限和 shell 转义复杂度
 *  - 多实例时按 port 命名隔离（settings/<port>.json）
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import { CLAUDE_REMOTE_DIR, SETTINGS_DIRNAME } from '@ocr/shared';
import { logger } from './logger/logger.js';

// ==============================
// Claude settings 生成
// ==============================

/**
 * 生成 Claude Code 的 hook 配置对象
 *
 * 包含两个 hook 事件：
 *  - Notification.permission_prompt：审批触发
 *  - PreToolUse.AskUserQuestion：保留以便未来扩展（当前 HookReceiver 会忽略）
 *
 * 两个事件都用同一条 curl 命令把 stdin 的 hook payload POST 到本地 /api/hook。
 * 用 -d @- 从 stdin 读避免 shell 转义复杂的 JSON。
 *
 * @param port 当前实例端口
 * @param existing 用户已有的 settings（如果有的话），将与本配置合并
 * @returns 完整可写入文件的 settings 对象
 */
export function createClaudeSettings(
  port: number,
  existing?: Record<string, unknown>,
): Record<string, unknown> {
  const hookUrl = `http://127.0.0.1:${port}/api/hook`;
  const hookCommand = `curl -s -X POST ${hookUrl} -H 'Content-Type: application/json' -d @-`;

  const ourHooks = {
    Notification: [
      {
        matcher: 'permission_prompt',
        hooks: [{ type: 'command', command: hookCommand }],
      },
    ],
    PreToolUse: [
      {
        matcher: 'AskUserQuestion',
        hooks: [{ type: 'command', command: hookCommand }],
      },
    ],
  };

  if (!existing) {
    return { hooks: ourHooks };
  }

  // 与用户原 settings 合并：保留其它字段，hooks.Notification/PreToolUse 被我们覆盖
  const existingHooks =
    existing['hooks'] && typeof existing['hooks'] === 'object'
      ? (existing['hooks'] as Record<string, unknown>)
      : {};

  const overlapped = ['Notification', 'PreToolUse'].filter((k) => k in existingHooks);
  if (overlapped.length > 0) {
    logger.warn(
      { overlapped },
      '用户已有同名 hook 事件被 claude-remote 覆盖（这是必需的）',
    );
  }

  return {
    ...existing,
    hooks: { ...existingHooks, ...ourHooks },
  };
}

/**
 * 落盘 Claude settings 到 ~/.claude-remote/settings/<port>.json
 *
 * 使用同步 IO，仅在启动阶段调用。
 *
 * @returns 文件绝对路径，调用方用此值传给 claude --settings <path>
 */
export function saveClaudeSettings(
  settings: Record<string, unknown>,
  port: number,
  baseDir?: string,
): string {
  const dir = baseDir ?? resolve(homedir(), CLAUDE_REMOTE_DIR);
  const settingsDir = resolve(dir, SETTINGS_DIRNAME);

  if (!existsSync(settingsDir)) {
    mkdirSync(settingsDir, { recursive: true, mode: 0o700 });
  }

  const path = resolve(settingsDir, `${port}.json`);
  writeFileSync(path, JSON.stringify(settings, null, 2), { encoding: 'utf-8', mode: 0o600 });
  logger.info({ path, port }, 'Claude settings 已写入');
  return path;
}

// ==============================
// 用户原参数中提取 --settings
// ==============================

/**
 * extractSettingsFromArgs 的返回值
 */
export interface ExtractedSettings {
  /** 原 --settings 参数的"值"（可能是文件路径或 'inline'） */
  source: string;
  /** 解析出来的 settings 对象（用于与我们的 hooks 合并） */
  value: Record<string, unknown>;
  /** 去除了 --settings 参数的剩余 args */
  remainingArgs: string[];
}

/**
 * 从用户传入的 claudeArgs 中找到 --settings 参数并解析其值
 *
 * 支持两种形式：
 *  - --settings <value>
 *  - --settings=<value>
 *
 * value 可以是：
 *  - 已存在的文件路径 → 读取并 JSON.parse
 *  - 内联 JSON 字符串 → 直接 JSON.parse
 *  - 其它 → 不识别，保留原样不改动
 *
 * @returns 找到并解析成功 → ExtractedSettings；未找到或解析失败 → null
 */
export function extractSettingsFromArgs(args: string[]): ExtractedSettings | null {
  let source: string | null = null;
  let value: Record<string, unknown> | null = null;
  const remaining: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? '';

    if (arg === '--settings' && i + 1 < args.length) {
      const v = args[i + 1] ?? '';
      i++; // 跳过 value 元素
      const parsed = tryParseSettingsValue(v);
      if (parsed) {
        source = parsed.source;
        value = parsed.value;
      } else {
        // 解析失败 → 保留 --settings 与 value 给 claude 自己处理（我们不擅自删）
        remaining.push(arg, v);
      }
    } else if (arg.startsWith('--settings=')) {
      const v = arg.slice('--settings='.length);
      const parsed = tryParseSettingsValue(v);
      if (parsed) {
        source = parsed.source;
        value = parsed.value;
      } else {
        remaining.push(arg);
      }
    } else {
      remaining.push(arg);
    }
  }

  if (value === null) return null;
  return { source: source ?? 'inline', value, remainingArgs: remaining };
}

/** 尝试把字符串值解析成 settings 对象（路径 → 文件内容；否则当 JSON 字符串） */
function tryParseSettingsValue(
  v: string,
): { source: string; value: Record<string, unknown> } | null {
  // 优先看是不是已存在的文件
  if (existsSync(v)) {
    try {
      const obj = JSON.parse(readFileSync(v, 'utf-8')) as Record<string, unknown>;
      return { source: v, value: obj };
    } catch (err) {
      logger.warn({ path: v, err }, '--settings 文件解析失败');
      return null;
    }
  }
  // 否则当作 inline JSON
  try {
    const obj = JSON.parse(v) as Record<string, unknown>;
    return { source: 'inline', value: obj };
  } catch {
    return null;
  }
}
