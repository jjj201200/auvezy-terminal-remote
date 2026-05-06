/**
 * 配置模块（阶段 4 完整版）
 *
 * 实现：
 *  - createClaudeSettings：生成 Claude Code 的 hooks 配置（指向 /api/hook）
 *  - saveClaudeSettings：把 settings 落到 ~/.auvezy/terminal-remote/settings/<port>.json
 *  - extractSettingsFromArgs：从用户原始 --settings 参数中分离出 settings 内容
 *  - loadUserConfig：读取 ~/.auvezy/terminal-remote/config.json，缺失/损坏时落默认
 *  - saveUserConfig：写入 config.json（atomic：tmp + rename）
 *  - loadConfig：把 ParsedCliArgs + 环境变量 + UserConfig + 默认值 合并成 AppConfig
 *
 * Hook 触发链路：
 *   Claude 弹审批 → 执行 hook command（curl POST /api/hook）→ HookReceiver
 *
 * 配置优先级（高 → 低）：
 *   CLI 参数 > 环境变量 > config.json > 编译期默认
 *
 * 为什么 settings 走文件而不是命令行内联：
 *  - claude --settings 接受文件路径或 JSON 字符串两种形式
 *  - 文件形式没有命令行长度上限和 shell 转义复杂度
 *  - 多实例时按 port 命名隔离（settings/<port>.json）
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
import {
  ATR_DATA_DIR,
  CONFIG_FILENAME,
  SETTINGS_DIRNAME,
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
      '用户已有同名 hook 事件被 atr 覆盖（这是必需的）',
    );
  }

  return {
    ...existing,
    hooks: { ...existingHooks, ...ourHooks },
  };
}

/**
 * 落盘 Claude settings 到 ~/.auvezy/terminal-remote/settings/<port>.json
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
  const dir = baseDir ?? resolve(homedir(), ATR_DATA_DIR);
  const settingsDir = resolve(dir, SETTINGS_DIRNAME);

  if (!existsSync(settingsDir)) {
    mkdirSync(settingsDir, { recursive: true, mode: 0o700 });
  }

  const path = resolve(settingsDir, `${port}.json`);
  writeFileSync(path, JSON.stringify(settings, null, 2), { encoding: 'utf-8', mode: 0o600 });
  logger.info({ path, port }, 'Claude settings 已写入');
  return path;
}

/**
 * 判断是否应该把 `--settings <path>` 注入到子进程参数。
 *
 * 策略：
 *  - 显式指令 ATR_INJECT_SETTINGS=true / 1 → 强制开
 *  - 显式指令 ATR_INJECT_SETTINGS=false / 0 → 强制关
 *  - 否则按 command basename 自动判定（'claude' 或带前缀如 'claude-dev'）
 *
 * 这样跑 bash / zsh / python / node 等不认识 --settings 的程序时不会被坑死。
 *
 * @param command spawn 用的命令名（绝对路径或裸名都行）
 * @param envOverride ATR_INJECT_SETTINGS 环境变量值
 */
export function shouldInjectSettings(
  command: string,
  envOverride: string | undefined,
): boolean {
  if (envOverride !== undefined) {
    const v = envOverride.trim().toLowerCase();
    if (v === 'true' || v === '1' || v === 'yes') return true;
    if (v === 'false' || v === '0' || v === 'no') return false;
    // 无法识别的值忽略，落回自动判定
  }
  // basename 后转小写，去掉 .exe / .cmd 等扩展（Windows 兼容）
  const base = basename(command).toLowerCase().replace(/\.(exe|cmd|bat)$/, '');
  return base === 'claude' || base.startsWith('claude-');
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

/** 计算 config.json 默认完整路径 */
export function defaultUserConfigPath(): string {
  return resolve(homedir(), ATR_DATA_DIR, CONFIG_FILENAME);
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
   *  - shared    从 ~/.auvezy/terminal-remote/config.json 共享文件读到（多实例共享）
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
  // 优先级：CLI 首位置参数 > env OCR_COMMAND > 兼容 CLAUDE_COMMAND > 默认 shell
  const explicitCommand =
    cli.command ?? env['OCR_COMMAND'] ?? readLegacyEnv(env, 'CLAUDE_COMMAND');
  const claudeCommand = explicitCommand ?? resolveDefaultShell(env);
  const claudeCwd =
    cli.workdir ?? env['OCR_CWD'] ?? readLegacyEnv(env, 'CLAUDE_CWD') ?? process.cwd();
  const explicitArgs = mergeClaudeArgs(
    cli.claudeArgs,
    env['OCR_ARGS'] ?? readLegacyEnv(env, 'CLAUDE_ARGS'),
  );
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

  // UserConfig
  const loaded = loadUser(cli.configPath);

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
    userConfig: loaded.value,
    userConfigPath: loaded.path,
  };
}

/**
 * 兼容读旧名 env：发现旧名时 warn 一次（每进程），鼓励迁移到新名 OCR_*。
 *
 * 旧名 CLAUDE_COMMAND / CLAUDE_ARGS / CLAUDE_CWD 会一直支持，但若同时设置
 * 新旧两个，新名 OCR_* 优先。
 */
const warnedLegacy = new Set<string>();
function readLegacyEnv(
  env: NodeJS.ProcessEnv,
  legacyKey: 'CLAUDE_COMMAND' | 'CLAUDE_ARGS' | 'CLAUDE_CWD',
): string | undefined {
  const v = env[legacyKey];
  if (v && !warnedLegacy.has(legacyKey)) {
    warnedLegacy.add(legacyKey);
    const newKey = legacyKey.replace('CLAUDE_', 'OCR_');
    logger.warn(
      { legacyKey, newKey },
      `环境变量 ${legacyKey} 已重命名为 ${newKey}（旧名仍支持，建议迁移）`,
    );
  }
  return v;
}

/**
 * 用户既没设 OCR_COMMAND 也没设旧名 CLAUDE_COMMAND 时，决定默认子进程命令。
 *
 * 优先级：
 *  1. $SHELL 环境变量（macOS / Linux / WSL 都自动有；用户当前 shell）
 *  2. 平台默认（Windows: cmd.exe；其它: /bin/sh）
 *
 * 选 $SHELL 而非硬编码 'claude'，因为不是所有用户都装了 Claude CLI；
 * 跑 shell 至少能让 PTY 通路有东西可调。要跑 Claude，显式设 OCR_COMMAND=claude。
 */
function resolveDefaultShell(env: NodeJS.ProcessEnv): string {
  const shell = env['SHELL'];
  if (shell && shell.length > 0) return shell;
  return process.platform === 'win32' ? 'cmd.exe' : '/bin/sh';
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
