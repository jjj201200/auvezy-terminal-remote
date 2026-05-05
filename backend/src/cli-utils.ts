/**
 * CLI 参数解析
 *
 * 仅做最小必要解析：把命令行 argv 解析成结构化对象，让 startServer 接收。
 * 不引入 yargs/commander：依赖小、行为可预期，且我们的参数集足够小。
 *
 * 支持形式：
 *   otr                          → 启动，PTY 跑默认 $SHELL
 *   otr <program> [args...]      → 启动，PTY 跑 program（args 透传）
 *                                  例：otr zsh / otr claude / otr claude --resume
 *   otr attach <url>             → 接管已有实例
 *   otr list                     → 列出本机所有实例
 *   otr stop [pattern]           → 停止匹配的实例
 *
 *   --flag                       → boolean = true
 *   --key value                  → 空格分隔
 *   --key=value                  → 等号分隔
 *   -- <剩余参数...>             → 透传给子进程（与 program 后位置参数等价）
 *
 * 第一个位置参数的判定规则：
 *   - 'attach' / 'stop' / 'list'：保留子命令
 *   - 其它非 flag 字符串：视为 PTY 子进程命令名（program）
 *   - "--" 之后的所有参数全部进 commandArgs（即使以 -- 开头）
 */

import { ConfigError } from './errors.js';
import { ErrorCode } from '@ocr/shared';

/** 已识别的 CLI flags 集合 */
const KNOWN_FLAGS_BOOL = new Set([
  '--no-terminal',
  '--no-color',
  '--help',
  '--version',
  '--no-open',
  '--wait-confirm',
]);

const KNOWN_FLAGS_VALUE = new Set([
  '--port',
  '--host',
  '--token',
  '--workdir',
  '--cwd',
  '--config',
  '--instance-name',
  '--max-buffer-lines',
  '--session-ttl',
  '--auth-rate-limit',
  '--log-dir',
]);

/** CLI 解析结果 */
export interface ParsedCliArgs {
  /** 子命令；默认 'start' */
  subcommand: 'start' | 'attach' | 'stop' | 'list';
  /** attach 子命令的 URL（仅 subcommand='attach' 时） */
  attachUrl?: string;
  /** stop 子命令的过滤模式（可选；不传 = 全部） */
  stopPattern?: string;
  /** 用户显式指定的 PTY 子进程命令名（来自首位置参数；优先于 env OCR_COMMAND） */
  command?: string;
  /** 监听端口 */
  port?: number;
  /** 监听 host */
  host?: string;
  /** 认证 Token（如果用户显式指定） */
  token?: string;
  /** Claude 工作目录（覆盖 process.cwd()） */
  workdir?: string;
  /** 显式指定 config.json 路径 */
  configPath?: string;
  /** 实例显示名 */
  instanceName?: string;
  /** 输出缓冲行数上限 */
  maxBufferLines?: number;
  /** Session TTL（毫秒） */
  sessionTtlMs?: number;
  /** 认证限流（次/分钟/IP） */
  authRateLimit?: number;
  /** 日志目录覆盖 */
  logDir?: string;
  /** 不写 PTY 输出到本进程 stdout */
  noTerminal?: boolean;
  /** 禁用彩色输出（保留口子，阶段 4 不强制实现） */
  noColor?: boolean;
  /** 不自动打开浏览器（保留口子） */
  noOpen?: boolean;
  /**
   * 启动 backend 后等用户按 Enter 才 spawn PTY 子进程（默认 false：立即 spawn）。
   * 老行为是"banner + 二维码留屏，扫码登录后再启全屏 TUI"——但多数用户嫌按 Enter 多余。
   * 仅 TTY 模式有效；headless 永远立即 spawn。
   */
  waitConfirm?: boolean;
  /** 显示 help 后退出 */
  help?: boolean;
  /** 显示版本号后退出 */
  version?: boolean;
  /**
   * 透传给子进程（PTY command）的位置参数。
   * 来源：首位置参数后的非 flag 位置参数 + "--" 之后所有参数。
   * 字段名保留 claudeArgs 是历史原因（早期项目限定 Claude）；语义已通用化。
   */
  claudeArgs: string[];
}

/**
 * 解析 process.argv（去掉 node + script 之后的部分）
 *
 * @param argv 形如 ['--port', '3001', '--', '--settings', '...']
 * @throws ConfigError 解析失败
 */
export function parseCliArgs(argv: string[]): ParsedCliArgs {
  const result: ParsedCliArgs = {
    subcommand: 'start',
    claudeArgs: [],
  };

  // 1. 首位置参数识别：保留子命令优先；其余视为 PTY 子进程 program
  //
  //   otr               → start (program=undefined，由 env/默认 shell 决定)
  //   otr attach <url>  → attach
  //   otr stop [pat]    → stop
  //   otr list          → list
  //   otr zsh           → start, command='zsh'
  //   otr claude --resume foo → start, command='claude', claudeArgs=['--resume','foo']
  let cursor = 0;
  if (argv[0] && !argv[0].startsWith('-')) {
    const sub = argv[0];
    if (sub === 'attach' || sub === 'stop' || sub === 'list') {
      result.subcommand = sub;
      cursor = 1;
      if (sub === 'attach') {
        if (!argv[1] || argv[1].startsWith('-')) {
          throw new ConfigError(
            ErrorCode.CONFIG_VALIDATION_FAIL,
            'attach 子命令需要 URL 参数：otr attach <url>',
          );
        }
        result.attachUrl = argv[1];
        cursor = 2;
      } else if (sub === 'stop') {
        // 可选 positional pattern
        if (argv[1] && !argv[1].startsWith('-')) {
          result.stopPattern = argv[1];
          cursor = 2;
        }
      }
    } else {
      // 任意其它非 flag 字符串：当 PTY program 用
      result.command = sub;
      cursor = 1;
    }
  }

  // 2. flag 解析（直到遇到 '--' 或结束）
  //
  // 当首位置参数已识别为 program 时，未知 flag 一律透传给子进程而非报错
  // （让 `otr claude --resume task1` 这类调用直观可用）。
  // 已知 flag（otr 自己的 --port / --workdir 等）仍按 otr 自身解析，不会被透传 ——
  // 用户如果真要给子进程传 --port 这种与 otr 同名的 flag，必须用 `-- --port` 显式分隔。
  const programGiven = (): boolean => result.command !== undefined;

  for (; cursor < argv.length; cursor++) {
    const arg = argv[cursor]!;

    if (arg === '--') {
      // 剩余全部追加到 claudeArgs
      result.claudeArgs.push(...argv.slice(cursor + 1));
      return result;
    }

    // --key=value 形式
    if (arg.startsWith('--') && arg.includes('=')) {
      const eq = arg.indexOf('=');
      const key = arg.slice(0, eq);
      const val = arg.slice(eq + 1);
      if (KNOWN_FLAGS_BOOL.has(key) || KNOWN_FLAGS_VALUE.has(key)) {
        assignFlag(result, key, val);
        continue;
      }
      if (programGiven()) {
        result.claudeArgs.push(arg);
        continue;
      }
      throw new ConfigError(ErrorCode.CONFIG_VALIDATION_FAIL, `未知参数：${arg}`);
    }

    // --flag 形式
    if (KNOWN_FLAGS_BOOL.has(arg)) {
      assignFlag(result, arg, true);
      continue;
    }

    // --key value 形式
    if (KNOWN_FLAGS_VALUE.has(arg)) {
      const val = argv[cursor + 1];
      if (val === undefined) {
        throw new ConfigError(
          ErrorCode.CONFIG_VALIDATION_FAIL,
          `参数 ${arg} 缺少值`,
        );
      }
      assignFlag(result, arg, val);
      cursor++;
      continue;
    }

    // 已识别 program → 任意未知参数透传
    if (programGiven()) {
      result.claudeArgs.push(arg);
      continue;
    }

    // 走到这里说明不认识
    throw new ConfigError(ErrorCode.CONFIG_VALIDATION_FAIL, `未知参数：${arg}`);
  }

  return result;
}

/** 把单个 flag 写入 result，按字段做类型转换 */
function assignFlag(out: ParsedCliArgs, key: string, value: string | boolean): void {
  switch (key) {
    case '--no-terminal':
      out.noTerminal = value === true || value === 'true';
      return;
    case '--no-color':
      out.noColor = value === true || value === 'true';
      return;
    case '--no-open':
      out.noOpen = value === true || value === 'true';
      return;
    case '--wait-confirm':
      out.waitConfirm = value === true || value === 'true';
      return;
    case '--help':
      out.help = true;
      return;
    case '--version':
      out.version = true;
      return;
    case '--port':
      out.port = parsePort(value);
      return;
    case '--host':
      out.host = String(value);
      return;
    case '--token':
      out.token = String(value);
      return;
    case '--workdir':
    case '--cwd':
      out.workdir = String(value);
      return;
    case '--config':
      out.configPath = String(value);
      return;
    case '--instance-name':
      out.instanceName = String(value);
      return;
    case '--max-buffer-lines':
      out.maxBufferLines = parsePositiveInt(key, value);
      return;
    case '--session-ttl':
      out.sessionTtlMs = parsePositiveInt(key, value);
      return;
    case '--auth-rate-limit':
      out.authRateLimit = parsePositiveInt(key, value);
      return;
    case '--log-dir':
      out.logDir = String(value);
      return;
    default:
      throw new ConfigError(ErrorCode.CONFIG_VALIDATION_FAIL, `未知参数：${key}`);
  }
}

function parsePort(value: string | boolean): number {
  if (typeof value !== 'string') {
    throw new ConfigError(ErrorCode.CONFIG_VALIDATION_FAIL, '--port 需要数值');
  }
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0 || n > 65535) {
    throw new ConfigError(ErrorCode.CONFIG_VALIDATION_FAIL, `--port 非法：${value}`);
  }
  return n;
}

function parsePositiveInt(name: string, value: string | boolean): number {
  if (typeof value !== 'string') {
    throw new ConfigError(ErrorCode.CONFIG_VALIDATION_FAIL, `${name} 需要数值`);
  }
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    throw new ConfigError(ErrorCode.CONFIG_VALIDATION_FAIL, `${name} 非法：${value}`);
  }
  return n;
}

/**
 * 帮助文本（--help 时输出）
 */
export const HELP_TEXT = `\
otr — open-terminal-remote · 局域网内远程访问 PC 终端的代理

用法：
  otr                              启动，PTY 跑当前 $SHELL
  otr <program> [args...]          启动，PTY 跑 program（args 透传）
                                   例：otr zsh / otr claude / otr claude --resume
  otr attach <url>                 接管已有实例
  otr list                         列出本机所有实例
  otr stop [pattern]               停止匹配的实例

启动选项：
  --port <n>            监听端口（默认 3000，被占用自动 +1）
  --host <ip>           监听 host（默认自动检测 LAN IP）
  --token <hex>         指定 Token（默认从共享文件读或生成）
  --workdir <path>      子进程工作目录（默认当前目录）
  --instance-name <s>   实例显示名（默认工作目录最后一段）
  --config <path>       config.json 路径（默认 ~/.claude-remote/config.json）
  --max-buffer-lines    输出缓冲行数（默认 10000）
  --session-ttl <ms>    Session 有效期，毫秒（默认 24h）
  --auth-rate-limit <n> 每分钟每 IP 认证次数上限（默认 20）
  --log-dir <path>      日志目录覆盖
  --no-terminal         不在本进程 stdout 显示 PTY 输出
  --no-color            禁用彩色输出
  --no-open             不自动打开浏览器
  --wait-confirm        启动 backend 后等用户按 Enter 才 spawn 子进程
                        （默认立即 spawn；适合不希望全屏 TUI 立刻覆盖 banner 的场景）
  --help                显示本帮助
  --version             显示版本号

  -- <args>             之后的参数也会透传给 program（与 program 后位置参数等价）

多实例：
  在不同终端多次执行 otr，会自动占用 3000、3001、3002…，
  每个实例独立 PTY；浏览器顶栏的实例 tab 可一键切换。
`;
