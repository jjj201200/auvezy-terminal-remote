/**
 * resolveSafePath:把外部输入的相对/绝对路径解析为可信的绝对路径
 *
 * 三段闸(design §5.1):
 *  1. path.resolve(cwd, input)          - 统一为绝对路径
 *  2. fs.realpathSync                    - 解 symlink 到真实路径
 *  3. checkWorkdir(real, allow, deny)    - workdir-policy 复审
 *
 * 通过 → 返回 real;不通过 → 抛 FileError。
 *
 * 路由层先用 instanceId 查 cwd + 当前 workdirPolicy 快照,再调本函数;
 * 本函数不直接接触 instances.json,便于单测。
 */

import { realpathSync } from 'node:fs';
import { isAbsolute, resolve as resolvePath } from 'node:path';
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
