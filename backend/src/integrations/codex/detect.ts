/**
 * Codex CLI 命令检测
 *
 * 判断"当前要 spawn 的命令是不是 OpenAI Codex CLI"。与 claude-code 的
 * detect 同构:basename 精确匹配 + Windows 后缀剥离。
 *
 * codex 无 claude 的 CLAUDE_CODE_ENTRYPOINT 等价物(全仓确认无特征入口 env,
 * 见 docs/research/codex-hooks-integration.md §6),detect 只能靠命令名;
 * atr 注入的 CODEX_HOME env 是运行期特征,不参与 spawn 判定。
 */

import { basename } from 'node:path';

/** Windows 可执行后缀,先剥再判名 */
const WIN_SUFFIXES = ['.exe', '.cmd', '.bat'];

/**
 * 接受的命令 basename(全部小写)
 *
 * codex 就一个名(无 claude-dev 式变体);`codex.cmd` 等命中。
 */
export function isCodexCommand(command: string): boolean {
  let name = basename(command).toLowerCase();
  for (const suffix of WIN_SUFFIXES) {
    if (name.endsWith(suffix)) {
      name = name.slice(0, name.length - suffix.length);
      break;
    }
  }
  return name === 'codex';
}
