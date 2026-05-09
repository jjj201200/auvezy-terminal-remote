/**
 * Claude Code 命令检测
 *
 * 判断"当前要 spawn 的命令是不是 Claude Code"。规则与原 shouldInjectSettings
 * 保持一致(basename 以 'claude' 起头),并显式列举 Windows 后缀。
 *
 * 这是模块化后唯一的检测点;其他地方(CLI 路径判断等)保留 shouldInjectSettings
 * 直到下一次清理。
 */

import { basename } from 'node:path';

/**
 * 接受的命令 basename 前缀(全部小写)
 *
 * 'claude' / 'claude-dev' / 'claude-canary' / 'claude.cmd' 等都命中。
 */
const CLAUDE_PREFIXES = ['claude'];

/** Windows 可执行后缀,先剥再判前缀 */
const WIN_SUFFIXES = ['.exe', '.cmd', '.bat'];

export function isClaudeCommand(command: string): boolean {
  let name = basename(command).toLowerCase();
  for (const suffix of WIN_SUFFIXES) {
    if (name.endsWith(suffix)) {
      name = name.slice(0, -suffix.length);
      break;
    }
  }
  return CLAUDE_PREFIXES.some((p) => name === p || name.startsWith(`${p}-`));
}
