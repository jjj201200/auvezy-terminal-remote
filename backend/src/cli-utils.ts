/**
 * CLI 参数解析（阶段 4）
 *
 * 仅做最小必要解析：把命令行 argv 解析成结构化对象，让 startServer 接收。
 * 不引入 yargs/commander：依赖小、行为可预期，且我们的参数集足够小。
 *
 * 支持形式：
 *   --flag                     → boolean = true
 *   --key value                → 空格分隔
 *   --key=value                → 等号分隔
 *   -- <剩余参数...>           → 透传给 claude（claudeArgs）
 *
 * 解析后未识别的参数：
 *   - "未知 --flag" 报错（防止用户拼错关键参数被静默忽略）
 *   - "--" 之后的所有参数全部进 claudeArgs，包括以 -- 开头的
 *
 * 子命令：
 *   - 默认：启动 server（subcommand = 'start'）
 *   - 'attach <url>'：阶段 7 启用，预留口子但本阶段不实现
 *   - 'stop' / 'list'：阶段 6a 启用
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
  /** 显示 help 后退出 */
  help?: boolean;
  /** 显示版本号后退出 */
  version?: boolean;
  /** "--" 之后的所有参数，原样透传给 claude */
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

  // 1. 子命令识别（仅在第一个非 flag 参数）
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
            'attach 子命令需要 URL 参数：claude-remote attach <url>',
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
      throw new ConfigError(ErrorCode.CONFIG_VALIDATION_FAIL, `未知子命令：${sub}`);
    }
  }

  // 2. flag 解析（直到遇到 '--' 或结束）
  for (; cursor < argv.length; cursor++) {
    const arg = argv[cursor]!;

    if (arg === '--') {
      // 剩余全部进 claudeArgs
      result.claudeArgs = argv.slice(cursor + 1);
      return result;
    }

    // --key=value 形式
    if (arg.startsWith('--') && arg.includes('=')) {
      const eq = arg.indexOf('=');
      const key = arg.slice(0, eq);
      const val = arg.slice(eq + 1);
      assignFlag(result, key, val);
      continue;
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
claude-remote — 远程访问 Claude Code 的 LAN 代理

用法：
  claude-remote [options] [-- <claude args>]
  claude-remote attach <url>          连入已有实例（阶段 7）
  claude-remote stop [pattern]        停止匹配实例（阶段 6a）
  claude-remote list                  列出注册实例（阶段 6a）

启动选项：
  --port <n>            监听端口（默认 3000，被占用自动 +1）
  --host <ip>           监听 host（默认自动检测 LAN IP）
  --token <hex>         指定 Token（默认从共享文件读或生成）
  --workdir <path>      Claude 工作目录（默认当前目录）
  --instance-name <s>   实例显示名（默认工作目录最后一段）
  --config <path>       config.json 路径（默认 ~/.claude-remote/config.json）
  --max-buffer-lines    输出缓冲行数（默认 10000）
  --session-ttl <ms>    Session 有效期，毫秒（默认 24h）
  --auth-rate-limit <n> 每分钟每 IP 认证次数上限（默认 20）
  --log-dir <path>      日志目录覆盖
  --no-terminal         不在本进程 stdout 显示 PTY 输出
  --no-color            禁用彩色输出
  --no-open             不自动打开浏览器
  --help                显示本帮助
  --version             显示版本号

  -- <claude args>      之后的参数原样透传给 claude
`;
