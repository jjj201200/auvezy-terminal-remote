/**
 * Codex hook trust:一键授权实现
 *
 * codex 对非托管 hooks(含 atr 注入的镜像 hooks.json)默认 Untrusted、静默
 * 跳过;trust 记录写在**真实** ~/.codex/config.toml 的 [hooks.state] 表:
 *
 *   [hooks.state."<hooks.json 绝对路径>:<event_snake>:<group_idx>:<handler_idx>"]
 *   enabled = true
 *   trusted_hash = "sha256:<hex>"
 *
 * 哈希算法复现(rust-v0.162.1 源码级核对,docs/research/codex-hooks-integration.md):
 *  NormalizedHookIdentity = { event_name(snake), matcher, hooks:[单个规范化 handler] }
 *  → TOML value → JSON → 所有对象键递归排序 → serde_json 紧凑序列化
 *  → SHA-256 → "sha256:<hex>"
 *
 * handler 参与哈希的键(type=command):async(false,无 skip 恒参与)/command/
 * timeout/None 字段(command_windows 等)在 TOML 转换时丢弃不参与。
 *
 * 版本敏感警示:codex 升级若改规范化结构,已写入的 trusted_hash 会失配 →
 * hooks 回到静默跳过。前端有"codex 在跑但零 hook 事件"的失效自检兜底,
 * 用户重新一键授权即可(本模块重算重写)。
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { logger } from '../../logger/logger.js';
import {
  CODEX_HOOK_COMMAND,
  CODEX_HOOK_EVENTS,
  eventSnakeCase,
} from './hooks-builder.js';

/** hooks.json 里 handler 的 timeout(与 hooks-builder 的 HOOK_TIMEOUT_SEC 一致;
 * 此处显式复述而非 import 私有常量——它参与哈希身份,改动即失效,双处来源
 * 反而醒目) */
const HOOK_TIMEOUT_SEC = 3;

/**
 * 递归按键排序的紧凑 JSON 序列化(对齐 serde_json sort_all_objects + to_vec)
 *
 * 仅支持 codex 哈希身份用到的类型(对象/数组/字符串/number/boolean);
 * 键序用默认字典序(UTF-16 码元,与 serde BTreeMap 排序对 ASCII 键一致)。
 */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    const body = keys
      .map((k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`)
      .join(',');
    return `{${body}}`;
  }
  return JSON.stringify(value);
}

/**
 * 计算单个 hook 的 trusted_hash
 *
 * @param eventSnake 事件 snake_case 名(如 'pre_tool_use')
 */
export function computeHookTrustHash(eventSnake: string): string {
  const identity = {
    event_name: eventSnake,
    // MatcherGroup flatten 到顶层:matcher 为 Some("")(hooks.json 显式空串)
    matcher: '',
    hooks: [
      {
        async: false,
        command: CODEX_HOOK_COMMAND,
        timeout: HOOK_TIMEOUT_SEC,
        type: 'command',
      },
    ],
  };
  const hex = createHash('sha256').update(canonicalJson(identity), 'utf8').digest('hex');
  return `sha256:${hex}`;
}

/** trust state key:`<hooks.json 绝对路径>:<event_snake>:<group_idx>:<handler_idx>` */
export function trustStateKey(hooksJsonPath: string, eventSnake: string): string {
  return `${hooksJsonPath}:${eventSnake}:0:0`;
}

/** TOML basic string 键的字面转义(路径常规只含 / : . -,双保险) */
function tomlQuoted(key: string): string {
  return `"${key.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

export interface CodexTrustStatus {
  /** trusted=全部事件哈希匹配;untrusted=有缺失/失配;no-config.toml=用户配置文件不存在(授权会创建) */
  status: 'trusted' | 'untrusted';
  /** 匹配的事件数 / 总注入事件数 */
  matched: number;
  total: number;
}

/**
 * 查询当前授权状态:读 ~/.codex/config.toml 的 [hooks.state],逐事件比对
 * trusted_hash 与当前应注入哈希
 *
 * @param configTomlPath 用户真实 config.toml 路径(如 ~/.codex/config.toml)
 * @param hooksJsonPath 镜像 hooks.json 绝对路径
 */
export function readCodexTrustStatus(
  configTomlPath: string,
  hooksJsonPath: string,
): CodexTrustStatus {
  const wanted = CODEX_HOOK_EVENTS.map((e) => ({
    key: trustStateKey(hooksJsonPath, eventSnakeCase(e)),
    hash: computeHookTrustHash(eventSnakeCase(e)),
  }));
  let text = '';
  try {
    text = readFileSync(configTomlPath, 'utf8');
  } catch {
    return { status: 'untrusted', matched: 0, total: wanted.length };
  }
  let matched = 0;
  for (const w of wanted) {
    const re = new RegExp(
      `^\\[hooks\\.state\\.${escapeRe(tomlQuoted(w.key))}\\][^\\[]*?trusted_hash\\s*=\\s*"${escapeRe(w.hash)}"`,
      'm',
    );
    if (re.test(text)) matched += 1;
  }
  return { status: matched === wanted.length ? 'trusted' : 'untrusted', matched, total: wanted.length };
}

/** 正则字面转义 */
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 一键授权:把全部注入事件的 trusted_hash 写进 ~/.codex/config.toml
 *
 * 行级文本处理(保留用户注释与其余内容;TOML 深层子表头可直接定义,
 * 位置无关,追加到文件末尾永远合法):
 *  - 已有同 key 段:段内(到下一个表头行前)有 trusted_hash 行→替换;
 *    没有→紧随段头插入 enabled + trusted_hash
 *  - 无段:文件末尾追加完整段
 * 原子写(tmp + rename)。
 *
 * @returns 写入的事件数
 * @throws 配置文件不可写(权限等)时抛 Error(调用方转 AppError)
 */
export function grantCodexTrust(
  configTomlPath: string,
  hooksJsonPath: string,
): number {
  let text = '';
  try {
    text = readFileSync(configTomlPath, 'utf8');
  } catch {
    text = ''; // 不存在 → 新建只含我们段的文件
  }

  const lines = text.split('\n');
  for (const e of CODEX_HOOK_EVENTS) {
    const snake = eventSnakeCase(e);
    const key = trustStateKey(hooksJsonPath, snake);
    const hash = computeHookTrustHash(snake);
    const header = `[hooks.state.${tomlQuoted(key)}]`;
    const hashLine = `trusted_hash = "${hash}"`;

    const headerIdx = lines.findIndex((l) => l.trim() === header);
    if (headerIdx === -1) {
      // 追加段(保证与上文之间有空行分隔)
      if (lines.length > 0 && lines[lines.length - 1]!.trim() !== '') lines.push('');
      lines.push(header, 'enabled = true', hashLine, '');
      continue;
    }
    // 段范围:headerIdx+1 到下一个表头行([ 开头)
    let end = headerIdx + 1;
    while (end < lines.length && !lines[end]!.trimStart().startsWith('[')) end += 1;
    const hashRow = lines.findIndex(
      (l, i) => i > headerIdx && i < end && /^\s*trusted_hash\s*=/.test(l),
    );
    if (hashRow !== -1) {
      lines[hashRow] = hashLine;
    } else {
      // 段存在但无 trusted_hash 行(如仅 enabled=false)→ 紧随段头插入
      lines.splice(headerIdx + 1, 0, hashLine);
    }
  }

  const out = lines.join('\n');
  const tmp = `${configTomlPath}.atr-tmp`;
  try {
    writeFileSync(tmp, out, { encoding: 'utf8', mode: 0o600 });
    renameSync(tmp, configTomlPath);
  } catch (err) {
    logger.error({ err, configTomlPath }, 'codex trust 写入失败');
    throw err;
  }
  logger.info({ configTomlPath }, 'codex trust: 已写入授权记录(重启 codex 后生效)');
  return CODEX_HOOK_EVENTS.length;
}

/** 镜像 hooks.json 路径是否存在(供 API 判 no-mirror) */
export function hooksJsonExists(hooksJsonPath: string): boolean {
  return existsSync(hooksJsonPath);
}
