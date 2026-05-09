/**
 * 配置模块
 *
 * 实现:
 *  - extractSettingsFromArgs:从用户原始 --settings 参数中分离出 settings 内容
 *  - loadUserConfig:读取 ~/.atrrc,缺失/损坏时落默认
 *  - saveUserConfig:写入 config.json(atomic:tmp + rename)
 *  - loadConfig:把 ParsedCliArgs + 环境变量 + UserConfig + 默认值 合并成 AppConfig
 *
 * 配置优先级(高 → 低):CLI 参数 > 环境变量 > config.json > 编译期默认
 *
 * Claude Code 的 hook settings 生成 / 文件落盘 / 命令检测全部迁到
 * backend/src/integrations/claude-code/(模块化:可热插拔)。
 */

import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  copyFileSync,
} from 'node:fs';
import { resolve, basename } from 'node:path';
import { homedir } from 'node:os';
import { statSync } from 'node:fs';
import {
  ATR_DATA_DIR,
  CONFIG_FILENAME,
  DEFAULT_PORT,
  DEFAULT_MAX_BUFFER_LINES,
  DEFAULT_SESSION_TTL_MS,
  DEFAULT_AUTH_RATE_LIMIT,
  DEFAULT_SPAWN_TIMEOUT_SEC,
  ErrorCode,
  ensureDefaultUserConfig,
  type UserConfig,
} from 'auvezy-terminal-remote-shared';
import { ConfigError } from './errors.js';
import { logger } from './logger/logger.js';
import type { ParsedCliArgs } from './cli-utils.js';
import { atomicWriteJson } from './utils/atomic-write.js';

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

// ==============================
// UserConfig 落盘 / 读取
// ==============================

/**
 * UserConfig + 路径上下文，便于调用方把"刚解析到的值"和"具体来源"绑在一起
 */
export interface LoadedUserConfig {
  /** 完整路径 */
  path: string;
  /** 解析后并已 ensureDefaultUserConfig 兜底的值 */
  value: UserConfig;
  /** 是否本次自动创建的（首次启动） */
  created: boolean;
  /** 是否检测到损坏并自动备份过 */
  recovered: boolean;
}

/**
 * 计算主配置文件默认完整路径
 *
 * 0.6.0 起：~/.atrrc（顶级 dotfile，CONFIG_FILENAME 已含前导点）
 * 与 ATR_DATA_DIR（~/.atr/，工具内部数据目录）同级；用户主要编辑入口
 */
export function defaultUserConfigPath(): string {
  return resolve(homedir(), CONFIG_FILENAME);
}

/**
 * 读取用户配置文件
 *
 * 行为：
 *  - 文件不存在 → 写入默认 UserConfig 并标记 created=true
 *  - 解析失败 → 备份到 <name>.corrupted-<ts> 后落默认，标记 recovered=true
 *  - 解析成功 → 经 ensureDefaultUserConfig 后返回（不写回文件以保持用户原意）
 *
 * 不抛错：任何 IO/parse 错误都被吞并降级到默认值，因为
 * 配置缺失绝不能阻塞服务启动。
 */
export function loadUserConfig(path: string = defaultUserConfigPath()): LoadedUserConfig {
  const dir = resolve(path, '..');

  // 确保目录存在（首次启动）
  if (!existsSync(dir)) {
    try {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
    } catch (err) {
      logger.warn({ dir, err }, 'config 目录创建失败（继续以默认值运行）');
    }
  }

  // 文件不存在 → 写默认
  if (!existsSync(path)) {
    const defaults = ensureDefaultUserConfig(null);
    try {
      atomicWriteJson(path, defaults);
      logger.info({ path }, '首次启动：已写入默认 config.json');
    } catch (err) {
      logger.warn({ path, err }, '默认 config.json 写入失败（仅内存使用默认值）');
    }
    return { path, value: defaults, created: true, recovered: false };
  }

  // 文件存在 → 读 + 解析
  let raw: string;
  try {
    raw = readFileSync(path, 'utf-8');
  } catch (err) {
    logger.warn({ path, err }, 'config.json 读失败，使用默认值');
    return {
      path,
      value: ensureDefaultUserConfig(null),
      created: false,
      recovered: false,
    };
  }

  try {
    const parsed = JSON.parse(raw) as UserConfig;
    return {
      path,
      value: ensureDefaultUserConfig(parsed),
      created: false,
      recovered: false,
    };
  } catch (err) {
    // 解析失败 → 备份原文件 + 落默认
    const backup = `${path}.corrupted-${Date.now()}`;
    try {
      copyFileSync(path, backup);
      logger.warn({ path, backup, err }, 'config.json 解析失败，已备份并落默认值');
    } catch (e2) {
      logger.error({ path, err, backupErr: e2 }, 'config.json 解析失败且备份失败');
    }
    const defaults = ensureDefaultUserConfig(null);
    try {
      atomicWriteJson(path, defaults);
    } catch (e3) {
      logger.warn({ path, err: e3 }, '默认 config.json 覆盖失败');
    }
    return { path, value: defaults, created: false, recovered: true };
  }
}

/**
 * 保存用户配置（atomic：写 tmp 后 rename）
 *
 * @throws ConfigError 写失败时抛
 */
export function saveUserConfig(value: UserConfig, path: string = defaultUserConfigPath()): void {
  const dir = resolve(path, '..');
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  try {
    atomicWriteJson(path, value);
    logger.info({ path }, 'config.json 已保存');
  } catch (err) {
    throw new ConfigError(
      ErrorCode.CONFIG_WRITE_FAILED,
      `config.json 写入失败：${(err as Error).message}`,
      500,
      err,
    );
  }
}

// ==============================
// AppConfig 合并（CLI > env > config.json > 默认）
// ==============================

/**
 * 运行时完整配置（all required，所有字段一定有值）
 *
 * 与 UserConfig 的区别：
 *  - UserConfig 只描述偏好、所有字段可选、文件层
 *  - AppConfig 含运行期决定的端口、token、host 等，不直接落盘
 */
export interface AppConfig {
  port: number;
  host: string;
  /** 已确定的 Token（可能来自 CLI / env / 共享文件 / 现场生成） */
  token: string;
  /**
   * Token 来源：
   *  - cli       --token
   *  - env       AUTH_TOKEN 环境变量
   *  - shared    从 ~/.atrrc 共享文件读到（多实例共享）
   *  - generated 共享文件未含 token，本进程刚生成并写盘
   */
  tokenSource: 'cli' | 'env' | 'shared' | 'generated';
  claudeCommand: string;
  claudeArgs: string[];
  claudeCwd: string;
  instanceName: string;
  maxBufferLines: number;
  sessionTtlMs: number;
  authRateLimit: number;
  noTerminal: boolean;
  /**
   * 严格端口模式：preferred 端口被占即报错，不自适应递增。
   * 来源优先级 CLI > env(STRICT_PORT) > 默认 false。
   */
  strictPort: boolean;
  /**
   * PTY spawn 兜底超时（秒）。0 = 无超时（永远等浏览器/Enter）。
   * 来源优先级 CLI > env(OCR_SPAWN_TIMEOUT) > 默认 30。
   * `--wait-confirm` 模式下被忽略（强制 Enter）。
   */
  spawnTimeoutSec: number;
  /**
   * dev 反代目标端口（vite dev server）；非 /api、/ws 的 HTTP/WS 转发到该端口。
   * 来源 CLI > env(ATR_DEV_PROXY) > undefined（默认不启用）。
   * 仅本地调试用：让手机扫码访问真后端端口也能拿到 vite HMR 实时前端。
   */
  devProxyPort?: number;
  /**
   * Workdir 白名单（picomatch glob 列表）。
   * 来源优先级：CLI > env(OCR_WORKDIR_ALLOW) > userConfig.workdirAllow > undefined。
   * undefined / [] 都视为"不设白名单"（不限制）。
   */
  workdirAllow?: string[];
  /**
   * Workdir 黑名单（picomatch glob 列表）。
   * 来源优先级：CLI > env(OCR_WORKDIR_DENY) > userConfig.workdirDeny > DEFAULT_WORKDIR_DENY。
   * 非 undefined 时即生效（包括用户显式 [] —— 表示"我要清空黑名单"，谨慎使用）。
   */
  workdirDeny: string[];
  /** 已加载的用户偏好（默认值兜底过） */
  userConfig: UserConfig;
  /** 用户配置文件路径（用于后续保存） */
  userConfigPath: string;
}

/**
 * loadConfig 入参
 *
 * cli：来自 parseCliArgs（subcommand !== 'start' 的场景调用方应当不进入此函数）
 * env：通常是 process.env；测试时可注入；显式必填以便单测纯函数化
 * generateToken：注入式，便于单测；正常调用方传 ./auth/token-generator.ts 的 generateToken
 */
export interface LoadConfigDeps {
  cli: ParsedCliArgs;
  env: NodeJS.ProcessEnv;
  generateToken: () => string;
  /** 用户配置加载器（注入便于测试） */
  loadUser?: (path?: string) => LoadedUserConfig;
}

/**
 * 把 CLI / env / config.json / 默认值 合并成 AppConfig
 *
 * 优先级（高到低）：
 *  - CLI > env > 内建默认
 *  - userConfig 仅作为偏好（shortcuts/commands），不参与端口/token 决定
 *
 * Token 来源标记：
 *  - 'cli' : --token
 *  - 'env' : AUTH_TOKEN（仅当 CLI 没传）
 *  - 'generated' : 现场 generateToken()
 *
 * 阶段 5 引入共享 token 文件后，这里会再加一个 'shared' 来源。
 */
export function loadConfig(deps: LoadConfigDeps): AppConfig {
  const { cli, env, generateToken, loadUser = loadUserConfig } = deps;

  const port = cli.port ?? toInt(env['PORT']) ?? DEFAULT_PORT;
  const host = cli.host ?? env['HOST'] ?? '0.0.0.0';
  // 优先级：CLI 首位置参数 > env OCR_COMMAND > 默认 shell
  const explicitCommand = cli.command ?? env['OCR_COMMAND'];
  const claudeCommand = explicitCommand ?? resolveDefaultShell(env);
  const claudeCwd = cli.workdir ?? env['OCR_CWD'] ?? process.cwd();
  const explicitArgs = mergeClaudeArgs(cli.claudeArgs, env['OCR_ARGS']);
  // 用户没指定 args 且我们用的是默认 shell 时，按 shell 类型补默认参数
  // （避免 zsh-newuser-install 向导、用户 rc 文件里的 exit 之类奇葩问题）
  const claudeArgs =
    explicitArgs.length > 0 || explicitCommand !== undefined
      ? explicitArgs
      : defaultShellArgs(claudeCommand);
  const instanceName =
    cli.instanceName ?? env['INSTANCE_NAME'] ?? (basename(claudeCwd) || 'instance');
  const maxBufferLines =
    cli.maxBufferLines ?? toInt(env['MAX_BUFFER_LINES']) ?? DEFAULT_MAX_BUFFER_LINES;
  const sessionTtlMs =
    cli.sessionTtlMs ?? toInt(env['SESSION_TTL_MS']) ?? DEFAULT_SESSION_TTL_MS;
  const authRateLimit =
    cli.authRateLimit ?? toInt(env['AUTH_RATE_LIMIT']) ?? DEFAULT_AUTH_RATE_LIMIT;
  const noTerminal = cli.noTerminal ?? env['NO_TERMINAL'] === 'true';
  const strictPort = cli.strictPort ?? env['STRICT_PORT'] === 'true';
  const spawnTimeoutSec =
    cli.spawnTimeoutSec ?? toInt(env['OCR_SPAWN_TIMEOUT']) ?? DEFAULT_SPAWN_TIMEOUT_SEC;
  const devProxyPort = cli.devProxy ?? toInt(env['ATR_DEV_PROXY']);

  // Token 三级
  let token: string;
  let tokenSource: AppConfig['tokenSource'];
  if (cli.token) {
    token = cli.token;
    tokenSource = 'cli';
  } else if (env['AUTH_TOKEN']) {
    token = env['AUTH_TOKEN'];
    tokenSource = 'env';
  } else {
    token = generateToken();
    tokenSource = 'generated';
  }

  // UserConfig（loadUser 已通过 ensureDefaultUserConfig 兜底过，
  // 所以 workdirAllow/workdirDeny 字段一定存在 —— 后者还包含默认黑名单）
  const loaded = loadUser(cli.configPath);

  // Workdir 白/黑名单：CLI > env > userConfig
  // ensureDefaultUserConfig 保证 loaded.value.workdirDeny 至少是 DEFAULT_WORKDIR_DENY
  const workdirAllow =
    cli.workdirAllow ??
    parseEnvPatternList(env['OCR_WORKDIR_ALLOW']) ??
    loaded.value.workdirAllow;
  const workdirDeny =
    cli.workdirDeny ??
    parseEnvPatternList(env['OCR_WORKDIR_DENY']) ??
    loaded.value.workdirDeny ??
    [];

  return {
    port,
    host,
    token,
    tokenSource,
    claudeCommand,
    claudeArgs,
    claudeCwd,
    instanceName,
    maxBufferLines,
    sessionTtlMs,
    authRateLimit,
    noTerminal,
    strictPort,
    spawnTimeoutSec,
    devProxyPort,
    workdirAllow,
    workdirDeny,
    userConfig: loaded.value,
    userConfigPath: loaded.path,
  };
}

/** 解析 env 中逗号分隔的 glob 列表；undefined / 空字符串保持 undefined（让链路继续往下走） */
function parseEnvPatternList(value: string | undefined): string[] | undefined {
  if (value === undefined) return undefined;
  const out: string[] = [];
  for (const part of value.split(',')) {
    const trimmed = part.trim();
    if (trimmed.length > 0) out.push(trimmed);
  }
  // 显式空值 → 视为"无白/黑名单"（让用户能用 OCR_WORKDIR_DENY="" 清空 —— 与 CLI 一致）
  return out;
}

/**
 * 用户没设 OCR_COMMAND 时，决定默认子进程命令。
 *
 * 优先级：
 *  1. $SHELL 环境变量（macOS / Linux / WSL 都自动有；用户当前 shell；
 *     Windows 上若用户在 Git Bash / WSL / cygwin 启动也会有这个变量）
 *  2. Windows: pwsh.exe > powershell.exe > cmd.exe
 *     - pwsh.exe：PowerShell 7+，跨平台版，用户主动装的（winget/Store/msi）
 *     - powershell.exe：Windows PowerShell 5.1，所有 Win 10/11 自带
 *     - cmd.exe：1990 年的产物，无 readline / ANSI 默认关闭，最后兜底
 *  3. 其它平台: /bin/sh
 *
 * 选 $SHELL 而非硬编码 'claude'，因为不是所有用户都装了 Claude CLI；
 * 跑 shell 至少能让 PTY 通路有东西可调。要跑 Claude，显式设 OCR_COMMAND=claude。
 */
function resolveDefaultShell(env: NodeJS.ProcessEnv): string {
  const shell = env['SHELL'];
  if (shell && shell.length > 0) return shell;
  if (process.platform === 'win32') {
    // 同步探测 PATH 上是否存在 pwsh / powershell。spawn 时 node-pty 会再走一次
    // PATH 解析，但提前检测可以选到第一个真实存在的命令而不是依赖 spawn 失败兜底。
    return resolveWindowsShell();
  }
  return '/bin/sh';
}

/**
 * Windows 默认 shell 选取：pwsh > powershell > cmd。
 *
 * 检测策略：在 PATH 里查可执行文件存在性。比起"spawn 失败再兜底"，
 * 提前检测能让 banner 上打印的命令名跟实际跑的一致，减少用户困惑。
 *
 * 不缓存：函数一次启动只调一次，没必要。
 */
function resolveWindowsShell(): string {
  const candidates = ['pwsh.exe', 'powershell.exe', 'cmd.exe'];
  const pathDirs = (process.env['PATH'] ?? '').split(';').filter(Boolean);
  // PATHEXT 决定无后缀名的查找；我们直接带 .exe 跳过这层
  for (const cmd of candidates) {
    for (const dir of pathDirs) {
      try {
        const full = `${dir}\\${cmd}`;
        // statSync 在 Windows 上对 .exe 探活足够；找不到抛错
        if (statSync(full).isFile()) {
          return cmd;
        }
      } catch {
        // 继续找下一个
      }
    }
  }
  // 全没找到（Windows 几乎不可能）—— 仍返回 cmd.exe 让 spawn 自己报错
  return 'cmd.exe';
}

/**
 * 当我们 fallback 到默认 shell 时给它一组合理的 default args。
 *
 * 目的：默认体验稳定，不被用户 ~/.zshrc / oh-my-zsh / zsh-newuser-install
 * 向导之类拖死整个 PTY。
 *
 * 策略：
 *  - bash / zsh / sh：`-i` 强制交互（保留 prompt + 行编辑）
 *  - 其它：不加任何参数（fish / 自定义 shell 自己处理）
 *
 * 用户想用自己的 rc 文件 → 显式 OCR_COMMAND=zsh OCR_ARGS='["-i","-l"]'。
 */
function defaultShellArgs(command: string): string[] {
  const base = command.split('/').pop()?.toLowerCase() ?? '';
  if (base === 'bash' || base === 'zsh' || base === 'sh') {
    return ['-i'];
  }
  return [];
}

/** 把 CLI 的 claudeArgs 与 env OCR_ARGS（JSON 数组形式）合并；CLI 优先 */
function mergeClaudeArgs(cliArgs: string[], envJson: string | undefined): string[] {
  if (cliArgs.length > 0) return cliArgs;
  if (!envJson) return [];
  try {
    const parsed = JSON.parse(envJson) as unknown;
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}

/** 把字符串解析为正整数；失败/0/负数都返回 undefined（让上层走默认） */
function toInt(s: string | undefined): number | undefined {
  if (!s) return undefined;
  const n = Number(s);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}
