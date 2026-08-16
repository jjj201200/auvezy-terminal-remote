/**
 * shell 函数 / alias fallback
 *
 * `atr zclaude` 的 zclaude 是用户 .zshrc 里的**函数**,node-pty 走 execvp 语义,
 * 只能在 PATH 上找可执行文件——函数与 alias 只存在于 shell 进程内存里,
 * 必须由 shell 解析。本模块把 spawn 目标改写为:
 *
 *   $SHELL -ic '<program> <args…（单引号逐参数转义）>'
 *
 * -i 让 shell 按 interactive 模式加载 rc（.zshrc / .bashrc），函数、alias、
 * rc 里的 export（典型:用户给 claude 配的 ANTHROPIC_BASE_URL 等网关变量）
 * 全部生效——等价于用户手动开终端再敲这条命令。
 *
 * 限制（已知且接受）:
 *  - rc 文件副作用会跑一遍(nvm/p10k 等),启动慢几百 ms
 *  - fallback 后 PTY program 是 shell,ClaudeCodeIntegration 的 detect 不再
 *    命中(claude 集成/hook 注入不生效)——能跑起来优先于集成
 *  - 仅 POSIX;Windows 的 shell 无对应"rc 函数"概念,返回 null 维持 127
 */

import { resolveExecutable } from './resolve-executable.js';

/**
 * POSIX 单引号转义:整体包 '…',内部 ' 替换为 '\''
 * 单引号内一切（$ ` " 空格）都是字面量,是唯一安全的跨 sh/bash/zsh 转义法
 */
export function shellQuote(s: string): string {
  return `'${s.replaceAll("'", `'\\''`)}'`;
}

/** fallback 结果:改写后的 spawn 目标 */
export interface InteractiveFallback {
  command: string;
  args: string[];
}

/**
 * 构造交互 shell 包裹的 spawn 参数
 *
 * @param program  用户原始命令名（如 zclaude）
 * @param args     用户原始参数
 * @param env      环境变量（读 $SHELL）；默认 process.env
 * @param platform 平台（默认 process.platform；测试注入）
 * @returns 改写后的 {command, args}；无法 fallback（win32 / 无 $SHELL /
 *          $SHELL 不可执行）返回 null,调用方维持原 127 报错
 */
export function buildInteractiveFallback(
  program: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): InteractiveFallback | null {
  if (platform === 'win32') return null;

  const shell = env['SHELL'];
  if (!shell || shell.length === 0) return null;
  // $SHELL 指向的 shell 必须真实存在（脏 SHELL 变量时宁可 127 也别 spawn 失败）
  if (!resolveExecutable(shell, env)) return null;

  const cmdline = [program, ...args].map(shellQuote).join(' ');
  return { command: shell, args: ['-ic', cmdline] };
}
