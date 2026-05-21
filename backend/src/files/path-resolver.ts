/**
 * resolveSafePath:把外部输入的相对/绝对路径解析为可信的绝对路径
 *
 * 四段闸(design §5.1,2026-05-21 加强为四段):
 *  1. path.resolve(cwd, input)            - 统一为绝对路径
 *  2. fs.realpathSync                     - 解 symlink 到真实路径
 *  3. **cwd 子树硬墙**:real 必须 === cwd 或在 cwd 子树内
 *     —— 严禁越过实例 cwd,哪怕 workdir-policy allow/deny 允许
 *  4. checkWorkdir(real, allow, deny)     - workdir-policy 兜底
 *
 * 通过 → 返回 real;不通过 → 抛 FileError。
 *
 * 路由层先用 instanceId 查 cwd + 当前 workdirPolicy 快照,再调本函数;
 * 本函数不直接接触 instances.json,便于单测。
 */

import { realpathSync } from 'node:fs';
import { isAbsolute, relative as relativePath, resolve as resolvePath } from 'node:path';
import { ErrorCode } from 'auvezy-terminal-remote-shared';
import { FileError } from '../errors.js';
import { checkWorkdir } from '../utils/workdir-policy.js';

/** workdir 策略快照(file-routes 与 search-engine 共用) */
export interface WorkdirPolicy {
  allow: readonly string[];
  deny: readonly string[];
}

/**
 * 把外部 path 输入解析为可信的绝对路径。
 *
 * @param cwd    实例工作目录绝对路径(由路由层从 instances.json 查得)
 * @param input  外部输入(相对或绝对),undefined / 空字符串 → 视为 "."
 * @param policy 当前 workdir 策略快照
 * @returns      已 realpath 且过 policy 的真实绝对路径
 * @throws FileError(PATH_NOT_FOUND | PATH_FORBIDDEN)
 */
export function resolveSafePath(
  cwd: string,
  input: string | undefined,
  policy: WorkdirPolicy,
): string {
  const raw = input && input.length > 0 ? input : '.';
  const abs = isAbsolute(raw) ? raw : resolvePath(cwd, raw);

  let real: string;
  try {
    real = realpathSync(abs);
  } catch (err) {
    throw new FileError(
      ErrorCode.PATH_NOT_FOUND,
      `path not found: ${abs}`,
      404,
      err,
    );
  }

  // cwd 边界(硬墙):resolved real 不允许越过实例 cwd 之上。
  // realpathSync 已把 cwd 也解到真路径,所以这里两边都是真路径可直接比较。
  const cwdReal = realpathSync(cwd);
  if (!isWithin(cwdReal, real)) {
    throw new FileError(
      ErrorCode.PATH_FORBIDDEN,
      `path outside instance cwd: ${real}`,
      403,
    );
  }

  // workdir-policy 兜底(deny / allow 仍会被尊重)
  const verdict = checkWorkdir(real, policy.allow, policy.deny);
  if (verdict !== null) {
    throw new FileError(
      ErrorCode.PATH_FORBIDDEN,
      `path forbidden: ${verdict.reason}`,
      403,
    );
  }

  return real;
}

/**
 * 判断 child 是否在 parent 子树内(或正是 parent)。
 *
 * 用 `path.relative` 而非字符串 startsWith,以正确处理:
 *  - 同名前缀("/a" 不是 "/aa" 的子) — relative('/a','/aa') === '../aa'
 *  - 平台分隔符差异
 *  - `.` / `..` 段
 */
function isWithin(parent: string, child: string): boolean {
  if (parent === child) return true;
  const rel = relativePath(parent, child);
  if (rel === '' || rel === '.') return true;
  // 跨设备(Windows 不同盘符)或越界 → relative 返回绝对路径或 '..' 起首
  if (isAbsolute(rel)) return false;
  if (rel.startsWith('..')) return false;
  return true;
}
