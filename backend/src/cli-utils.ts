/**
 * CLI 参数解析
 *
 * 仅做最小必要解析：把命令行 argv 解析成结构化对象，让 startServer 接收。
 * 不引入 yargs/commander：依赖小、行为可预期，且我们的参数集足够小。
 *
 * 支持形式：
 *   atr                          → 启动，PTY 跑默认 $SHELL
 *   atr <program> [args...]      → 启动，PTY 跑 program（args 透传）
 *                                  例：atr zsh / atr claude / atr claude --resume
 *   atr start [--port n]         → 前台启 broker 服务（自启服务也是这条）
 *   atr stop                     → 停 broker 服务（无参；旧 `atr stop <pattern>` → atr kill）
 *   atr status / list / logs / install / uninstall
 *                                → 服务级 subcommand（详见 broker/cli.ts）
 *   atr attach <url>             → 接管已有实例
 *   atr kill <pattern | all>     → 停止匹配的实例(必填;`all` = 所有,带确认)
 *
 *   --flag                       → boolean = true
 *   --key value                  → 空格分隔
 *   --key=value                  → 等号分隔
 *   -- <剩余参数...>             → 透传给子进程（与 program 后位置参数等价）
 *
 * 第一个位置参数的判定规则：
 *   - 保留 subcommand（start/stop/status/list/logs/install/uninstall/attach/kill）：
 *     识别为子命令；想跑同名 PATH 二进制需 `atr ./<name>` 或 `atr -- <name>`
 *   - 其它非 flag 字符串：视为 PTY 子进程命令名（program）
 *   - "--" 之后的所有参数全部进 claudeArgs（即使以 -- 开头）
 */

import { ConfigError } from './errors.js';
import { ErrorCode } from 'auvezy-terminal-remote-shared';

/** 已识别的 CLI flags 集合 */
const KNOWN_FLAGS_BOOL = new Set([
  '--no-terminal',
  '--no-color',
  '--help',
  '--version',
  '--no-open',
  '--wait-confirm',
  '--strict-port',
  '--foreground',
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
  '--spawn-timeout',
  '--workdir-allow',
  '--workdir-deny',
]);

/**
 * 可选 value 的 flag：单独出现时 = true（语义由 assignFlag 决定），
 * 后跟非 flag 字符串时取该字符串作为值。
 *
 * --dev-proxy：无值 = 自动发现 vite 端口；带值 = 固定到该端口
 */
const KNOWN_FLAGS_OPTIONAL_VALUE = new Set([
  '--dev-proxy',
]);

/**
 * 全部已知长 flag 名（用于 didyoumean 拼写建议）。
 * 不含短选项 —— 短选项太短做相似度匹配几乎全是噪声。
 */
export const KNOWN_LONG_FLAGS: readonly string[] = [
  ...KNOWN_FLAGS_BOOL,
  ...KNOWN_FLAGS_VALUE,
  ...KNOWN_FLAGS_OPTIONAL_VALUE,
];

/**
 * 短选项 → 长选项规范化映射
 *
 * 仅在解析最外层 argv 时生效。`--` 之后的透传参数不做规范化（避免误改子进程参数）。
 * 当首位置参数已识别为 program、未在此映射内的任意 -x/-X 也仍透传，不报错。
 */
const SHORT_TO_LONG: Record<string, string> = {
  '-p': '--port',
  '-h': '--help',
  '-v': '--version',
  '-S': '--strict-port',
};

/**
 * 服务级动作（管 broker / 列实例 / 装卸自启）。
 *
 * 0.7.x 起以 subcommand 形式触发：`atr start` / `atr status` / `atr list` 等。
 * 这些 subcommand 是**保留字**——用户不能用它们做 PTY program 名（被识别为
 * subcommand 优先；想跑同名 PATH 二进制需 `atr -- <name>` 或 `atr ./name`）。
 *
 * 命名：
 *  - `start` / `stop` / `status`：管 broker 进程（前台启 / 关 / 看健康）
 *  - `list`：列当前活实例
 *  - `install` / `uninstall`：装 / 卸开机自启服务（systemd / launchd）
 *  - `logs`：tail broker 当天 log
 *
 * 注：旧版本的 `--start` / `--stop` / ... flag 形式已删除，改 subcommand。
 * 旧 `atr stop <pattern>` 停实例的语义迁移到 `atr kill <pattern>`；新
 * `atr stop`（无参）= 停 broker。
 */
export type ServiceAction =
  | 'start'
  | 'stop'
  | 'status'
  | 'list'
  | 'install'
  | 'uninstall'
  | 'logs';

/**
 * subcommand 字符串 → ServiceAction 映射。
 *
 * 这些**词**在位置 0（`atr <word>`）一律识别为 subcommand，**不**作 program 名
 * （除非用 `--` 显式分隔或带路径前缀如 `./start`）。冲突时入口可询问用户。
 */
const SUBCOMMAND_TO_SERVICE: Record<string, ServiceAction> = {
  start: 'start',
  stop: 'stop',
  status: 'status',
  list: 'list',
  install: 'install',
  uninstall: 'uninstall',
  logs: 'logs',
};

/** 全部保留 subcommand（service + attach + kill + completion） */
export const RESERVED_SUBCOMMANDS = new Set<string>([
  ...Object.keys(SUBCOMMAND_TO_SERVICE),
  'attach',
  'kill',
  'completion',
]);

/** CLI 解析结果 */
export interface ParsedCliArgs {
  /**
   * 子命令分类：
   *  - `pty`        = 派生 PTY（默认；含 atr 无参 / atr [program] / atr -p N [program]）
   *  - `service`    = 管 broker（start/stop/status/list/logs/install/uninstall）
   *  - `attach`     = atr attach <url>，CLI 客户端连入实例
   *  - `kill`       = atr kill <pattern|all>，停指定实例
   *  - `completion` = atr completion <shell>，emit shell 补全脚本
   */
  subcommand: 'pty' | 'attach' | 'kill' | 'service' | 'completion';
  /** completion 子命令的目标 shell（zsh/bash/fish）；仅 subcommand='completion' 时有值 */
  completionShell?: string;
  /** attach 子命令的 URL（仅 subcommand='attach' 时） */
  attachUrl?: string;
  /**
   * kill 子命令的过滤模式。
   *  - 不传:cli-stop.ts 里报错(必填)
   *  - 'all':表示杀全部,带二次确认
   *  - 其它:substring 匹配 instance.name / cwd / host:port
   */
  killPattern?: string;
  /** 服务级动作（仅 subcommand='service' 时） */
  serviceAction?: ServiceAction;
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
  /**
   * 严格端口模式：preferred 端口被占即报错退出，不自适应递增。
   * 适合 CI / 反向代理后端这种"必须固定端口"的部署。
   */
  strictPort?: boolean;
  /**
   * `atr start` 前台运行 broker（默认 daemonize 后台 fork 后立即返回）。
   * 给 systemd ExecStart / launchd / Docker ENTRYPOINT 这类需要进程 attach 的场景用。
   */
  foreground?: boolean;
  /**
   * PTY spawn 兜底超时（秒）。0 表示无超时（永远等浏览器/Enter）。
   * 默认 30s。`--wait-confirm` 模式下被忽略（必须 Enter）。
   */
  spawnTimeoutSec?: number;
  /**
   * dev 反代目标端口：非 /api、/ws 的 HTTP/WS 请求转发到 http://127.0.0.1:<devProxy>
   * （vite dev server）。让手机访问真后端端口也能拿到 HMR 实时前端。
   * 仅本地调试用；不指定则不启用。
   */
  devProxy?: number;
  /**
   * Workdir 白名单（picomatch glob 模式，逗号分隔）。
   * 优先级高于 ~/.atrrc 的 workdirAllow 字段（命令行覆盖文件）。
   * 示例：--workdir-allow "/home/me/projects/**,/mnt/d/work/**"
   */
  workdirAllow?: string[];
  /**
   * Workdir 黑名单（picomatch glob 模式，逗号分隔）。
   * 优先级高于 ~/.atrrc 的 workdirDeny 字段。
   * 注意：CLI 显式 --workdir-deny "" 等同于"不要任何黑名单"，可绕过默认敏感路径保护
   */
  workdirDeny?: string[];
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
    subcommand: 'pty',
    claudeArgs: [],
  };

  // 解析模型（0.7.x 起）：
  //
  //   atr <subcommand> [args...]              # service / kill / attach
  //   atr [atr-flags...] [program] [args...]  # PTY 派生
  //
  // 严格规则：atr 自己的 flag 必须在 program 之前。一旦遇到 program 名，
  // 之后所有 token 原样透传给子进程。
  //
  // Reserved subcommand 优先：start / stop / status / list / logs / install /
  // uninstall / attach / kill 在位置 0 一律识别为 subcommand，**不**视作 PTY
  // program 名。冲突时入口可询问用户（PATH 上同名二进制存在时）。想真跑同名
  // 二进制：用 `atr ./<name>` 或 `atr -- <name>`。
  //
  // 优先级（从高到低）：
  //   a. service subcommand：start / stop / status / list / logs / install /
  //      uninstall —— 仅 'start' 接受配置 flag（--port / --host）
  //   b. attach <url>
  //   c. kill [pattern]
  //   d. atr-flags + program：atr [-p N ...] [program] [args...]
  //   e. 无任何位置参数：跑默认 $SHELL
  let cursor = 0;
  const first = argv[0];

  // ── service subcommand ──
  if (first && SUBCOMMAND_TO_SERVICE[first]) {
    const action = SUBCOMMAND_TO_SERVICE[first]!;
    result.subcommand = 'service';
    result.serviceAction = action;
    cursor = 1;
    if (action === 'start') {
      // 'start' 接受 --port / --host 配置 flag；落到下方 flag 解析循环。
    } else if (argv[1] && argv[1] !== '--') {
      throw new ConfigError(
        ErrorCode.CONFIG_VALIDATION_FAIL,
        `'atr ${first}' takes no extra arguments — it reads broker info from ~/.atr/broker.json automatically`,
      );
    } else {
      return result;
    }
  } else if (first === 'attach') {
    result.subcommand = 'attach';
    if (!argv[1] || argv[1].startsWith('-')) {
      throw new ConfigError(
        ErrorCode.CONFIG_VALIDATION_FAIL,
        'attach requires a URL: atr attach <url>',
      );
    }
    result.attachUrl = argv[1];
    if (argv.length > 2) {
      throw new ConfigError(
        ErrorCode.CONFIG_VALIDATION_FAIL,
        'attach takes only a URL; no extra arguments',
      );
    }
    return result;
  } else if (first === 'kill') {
    result.subcommand = 'kill';
    if (argv[1] && !argv[1].startsWith('-')) {
      result.killPattern = argv[1];
      if (argv.length > 2) {
        throw new ConfigError(
          ErrorCode.CONFIG_VALIDATION_FAIL,
          'kill takes only one pattern; no extra arguments',
        );
      }
    } else if (argv.length > 1) {
      throw new ConfigError(
        ErrorCode.CONFIG_VALIDATION_FAIL,
        'kill takes only one pattern; no flags',
      );
    }
    // 必填检查由 cli-stop.ts 做(那里能给出更友好的多行 hint)
    return result;
  } else if (first === 'completion') {
    result.subcommand = 'completion';
    if (!argv[1] || argv[1].startsWith('-')) {
      throw new ConfigError(
        ErrorCode.CONFIG_VALIDATION_FAIL,
        'completion requires a shell name: atr completion <zsh|bash|fish>',
      );
    }
    result.completionShell = argv[1];
    if (argv.length > 2) {
      throw new ConfigError(
        ErrorCode.CONFIG_VALIDATION_FAIL,
        'completion takes only the shell name; no extra arguments',
      );
    }
    return result;
  } else if (first && !first.startsWith('-')) {
    // 任意其它非 flag 字符串：当 PTY program；剩余全部透传。
    result.command = first;
    result.claudeArgs.push(...argv.slice(1));
    return result;
  }

  // ── flag 解析循环（program 之前；atr 自己吃 flag）──
  for (; cursor < argv.length; cursor++) {
    let arg = argv[cursor]!;

    if (arg === '--') {
      result.claudeArgs.push(...argv.slice(cursor + 1));
      return result;
    }

    if (arg.length === 2 && arg.startsWith('-') && !arg.startsWith('--')) {
      const mapped = SHORT_TO_LONG[arg];
      if (mapped !== undefined) arg = mapped;
    }

    if (arg.startsWith('--') && arg.includes('=')) {
      const eq = arg.indexOf('=');
      const key = arg.slice(0, eq);
      const val = arg.slice(eq + 1);
      if (KNOWN_FLAGS_BOOL.has(key) || KNOWN_FLAGS_VALUE.has(key)) {
        assignFlag(result, key, val);
        continue;
      }
      throw new ConfigError(
        ErrorCode.CONFIG_VALIDATION_FAIL,
        `unknown argument: ${arg}. atr flags must precede the program; flags meant for the program go after the program name.`,
      );
    }

    if (KNOWN_FLAGS_BOOL.has(arg)) {
      assignFlag(result, arg, true);
      continue;
    }

    if (KNOWN_FLAGS_VALUE.has(arg)) {
      const val = argv[cursor + 1];
      if (val === undefined) {
        throw new ConfigError(
          ErrorCode.CONFIG_VALIDATION_FAIL,
          `flag ${arg} requires a value`,
        );
      }
      assignFlag(result, arg, val);
      cursor++;
      continue;
    }

    if (KNOWN_FLAGS_OPTIONAL_VALUE.has(arg)) {
      const peek = argv[cursor + 1];
      if (peek !== undefined && !peek.startsWith('-')) {
        assignFlag(result, arg, peek);
        cursor++;
      } else {
        assignFlag(result, arg, true);
      }
      continue;
    }

    // 不以 `-` 开头 → 视为 program（隐式分隔点）；剩余全部透传，解析终止。
    if (!arg.startsWith('-')) {
      if (result.subcommand === 'service') {
        throw new ConfigError(
          ErrorCode.CONFIG_VALIDATION_FAIL,
          `'atr ${result.serviceAction}' does not accept a program name (got "${arg}")`,
        );
      }
      result.command = arg;
      result.claudeArgs.push(...argv.slice(cursor + 1));
      return result;
    }

    throw new ConfigError(
      ErrorCode.CONFIG_VALIDATION_FAIL,
      `unknown argument: ${arg}. atr flags must precede the program; flags meant for the program go after the program name.`,
    );
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
    case '--strict-port':
      out.strictPort = value === true || value === 'true';
      return;
    case '--foreground':
      out.foreground = value === true || value === 'true';
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
    case '--spawn-timeout':
      out.spawnTimeoutSec = parseNonNegativeInt(key, value);
      return;
    case '--dev-proxy':
      // 不带值 / 'auto' / '0' → 自动发现（用 0 标记，dev-proxy 内部探活 5173..）
      // 带数字 → 固定端口
      if (value === true || value === '' || value === 'auto' || value === '0') {
        out.devProxy = 0;
      } else {
        out.devProxy = parsePort(value);
      }
      return;
    case '--log-dir':
      out.logDir = String(value);
      return;
    case '--workdir-allow':
      out.workdirAllow = parsePatternList(value);
      return;
    case '--workdir-deny':
      // 显式 --workdir-deny "" 视为"我要清空黑名单"——保留 [] 而不是 fallback 到默认
      out.workdirDeny = parsePatternList(value);
      return;
    default:
      throw new ConfigError(ErrorCode.CONFIG_VALIDATION_FAIL, `unknown argument: ${key}`);
  }
}

/**
 * 解析逗号分隔的 glob pattern 列表。
 *
 * 空字符串 → []（用户显式想清空，比如 --workdir-deny ""）
 * 多个值用逗号分隔；每项 trim；空项剔除。
 *
 * 不在这里校验 pattern 合法性 —— picomatch 接受任意字符串，非法的会自然 not match
 */
function parsePatternList(value: string | boolean): string[] {
  if (typeof value !== 'string') return [];
  const out: string[] = [];
  for (const part of value.split(',')) {
    const trimmed = part.trim();
    if (trimmed.length > 0) out.push(trimmed);
  }
  return out;
}

function parsePort(value: string | boolean): number {
  if (typeof value !== 'string') {
    throw new ConfigError(ErrorCode.CONFIG_VALIDATION_FAIL, '--port requires a number');
  }
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0 || n > 65535) {
    throw new ConfigError(ErrorCode.CONFIG_VALIDATION_FAIL, `invalid --port: ${value}`);
  }
  return n;
}

function parsePositiveInt(name: string, value: string | boolean): number {
  if (typeof value !== 'string') {
    throw new ConfigError(ErrorCode.CONFIG_VALIDATION_FAIL, `${name} requires a number`);
  }
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    throw new ConfigError(ErrorCode.CONFIG_VALIDATION_FAIL, `invalid ${name}: ${value}`);
  }
  return n;
}

function parseNonNegativeInt(name: string, value: string | boolean): number {
  if (typeof value !== 'string') {
    throw new ConfigError(ErrorCode.CONFIG_VALIDATION_FAIL, `${name} requires a number`);
  }
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) {
    throw new ConfigError(ErrorCode.CONFIG_VALIDATION_FAIL, `invalid ${name}: ${value}`);
  }
  return n;
}

/**
 * 帮助文本（--help 时输出）
 */
export const HELP_TEXT = `\
atr — auvezy/terminal-remote · LAN-only browser access to your terminal

Usage:
  atr [atr-flags...] [program] [program-args...]
                                   run a PTY child (default: $SHELL) and expose it on the LAN
  atr <subcommand> [...]           manage the broker / instances (see below)

Subcommands:
  start [--port n] [--host ip]     start the background service (broker); the command
                                   returns immediately once the broker is healthy.
                                   add --foreground to keep it attached (systemd / Docker).
  stop                             stop the background service
  status                           one-shot view: process, token, entry URLs, instances
  list                             list all live instances
  logs                             tail today's service log (~/.atr/broker-YYYY-MM-DD.log)
  install                          register autostart (systemd / launchd)
  uninstall                        remove autostart
  attach <url>                     attach a CLI client to an existing instance
  kill <pattern | all>             kill instances matching pattern (name/cwd/host:port);
                                   pass 'all' to kill every running instance (with confirm)

  Reserved words: the subcommands above always take precedence at position 0.
  To run a PATH binary with the same name (e.g. an executable called "start"),
  use a path prefix: 'atr ./start' or place it after '--': 'atr -- start'.

Strict argument order:
  atr's own flags must come BEFORE the program name. Once <program> is seen,
  every remaining token is passed through to the child process — atr no longer
  parses anything (no flag aliasing, no ambiguity).

  Examples:
    atr                              run default $SHELL
    atr zsh                          run zsh
    atr claude --resume task1        run claude with its own args
    atr -p 3010 claude               broker port = 3010, then run claude
    atr -p 3010 claude --port 9      -p 3010 → atr; --port 9 passed to claude
    atr -- --weird                   '--' forces split; default shell with '--weird'

Run options (for atr [program]):
  -p, --port <n>        Background service (broker) port (default 3737). If broker is
                        already running and on a different port, atr will refuse to
                        start — run 'atr stop' first if you want to switch.
                        Worker ports are internal and auto-assigned; you don't set them.
  --host <ip>           Service listen host (default 0.0.0.0; workers always bind 127.0.0.1)
  -S, --strict-port     Strict-port mode: error out if preferred port is taken (no auto-bump)
  --spawn-timeout <s>   PTY spawn fallback timeout in seconds (default 30; 0 = no timeout).
                        Mutually exclusive with --wait-confirm.
  --token <hex>         Use a fixed token (default reads / generates one in ~/.atrrc)
  --workdir <path>      Child process cwd (default: current directory)
  --instance-name <s>   Instance display name (default: last segment of cwd)
  --config <path>       config.json path (default: ~/.atrrc)
  --max-buffer-lines    Output buffer line cap (default 10000)
  --session-ttl <ms>    Session TTL in ms (default 24h)
  --auth-rate-limit <n> Auth attempts per minute per IP (default 20)
  --log-dir <path>      Override log directory
  --workdir-allow <patterns>
                        cwd allow-list (picomatch glob, comma-separated). When set,
                        new instance cwd must match at least one pattern.
                        e.g. --workdir-allow "/home/me/projects/**,/mnt/d/**"
  --workdir-deny <patterns>
                        cwd deny-list (picomatch glob, comma-separated).
                        Match means reject. Default includes sensitive system paths
                        (/etc/**, /root/**, ...); pass "" to clear. CLI overrides ~/.atrrc.
  --no-terminal         Don't echo PTY output on this process's stdout
  --no-color            Disable colored output
  --no-open             Don't auto-open the browser
  --wait-confirm        Wait for Enter before spawning the PTY child
                        (default: spawn immediately; use this if a full-screen TUI
                        would otherwise hide the banner)
  -h, --help            Show this help
  -v, --version         Show version

  --                    Explicit separator; tokens after '--' pass through to program
                        (only needed in atr-flag area; after a program name everything
                        passes through automatically)

Multi-instance:
  The background service (broker) runs once on port 3737 and is shared by all
  instances. Running atr [program] in different terminals all connect to the
  same service; PTY children are independent. Click the tab bar in the browser
  to switch between them. If the service isn't running, the first atr will
  auto-fork one.
`;
