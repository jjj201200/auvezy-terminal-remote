/**
 * 服务级 CLI runner（atr subcommand 触发）
 *
 * 由 backend/src/cli.ts 在解析到 `atr start` / `atr stop` / `atr status` /
 * `atr list` / `atr install` / `atr uninstall` / `atr logs` 时调用。
 *
 *  - start      → 启 broker（前台），listen + 反代 + 阻塞
 *                 （`atr install` 后由 systemd/launchd 拉起的也是这条）
 *  - stop       → 读 broker.json，向 PID 发 SIGTERM，超时强 SIGKILL，清 state
 *  - status     → broker.json + 探活 + HTTP probe，结构化输出 + 含实例数
 *  - list       → 列当前活实例
 *  - install    → 写 systemd / launchd 配置，开机自启
 *  - uninstall  → 删 systemd / launchd 配置
 *  - logs       → tail broker 当天 log 文件（~/.atr/broker-YYYY-MM-DD.log)
 *
 * 演化：0.6.x 用 `atr broker xxx` 二级子命令；0.7.0 改顶层 flag（`--start`...）；
 * 0.7.x 进一步规范化为顶层 subcommand（`atr start`...，与 git/docker 一致）。
 * 旧 `atr stop <pattern>` 停实例的语义迁到 `atr kill <pattern>`，新 `atr stop`
 * 无参 = 停 broker。文件名 broker/cli.ts 是历史原因；管的是"服务级"操作。
 */

import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { ATR_DATA_DIR } from 'auvezy-terminal-remote-shared';
import {
  startBrokerServer,
  DEFAULT_BROKER_PORT,
  DEFAULT_BROKER_HOST,
  type BrokerApiDeps,
} from './broker-server.js';
import {
  createBrokerLogRotator,
  type BrokerLogRotator,
} from './broker-log-rotator.js';
import { InstanceRegistryManager } from '../registry/instance-registry.js';
import { DefaultInstanceSpawner } from '../registry/instance-spawner.js';
import {
  startInstanceWatcher,
  stopInstanceWatcher,
} from '../registry/instance-events.js';
import { acquireSharedToken } from '../registry/shared-token.js';
import { generateToken as generateAuthToken } from '../auth/token-generator.js';
import {
  AuthModule,
  DEFAULT_SESSION_COOKIE_NAME,
} from '../auth/auth-middleware.js';
import { SessionsStore } from '../sessions/sessions-store.js';
import { PushService } from '../push/push-service.js';
import {
  loadUserConfig,
  saveUserConfig,
  defaultUserConfigPath,
} from '../config.js';
import type { ConfigStore } from '../api/config-routes.js';
import type { UserConfig } from 'auvezy-terminal-remote-shared';
import { detectDisplayIp } from '../utils/network.js';
import {
  DEFAULT_AUTH_RATE_LIMIT,
  DEFAULT_SESSION_TTL_MS,
} from 'auvezy-terminal-remote-shared';
import { logger } from '../logger/logger.js';
import {
  clearBrokerState,
  defaultBrokerStatePath,
  isBrokerAlive,
  readBrokerState,
} from './broker-state.js';
import {
  install as installService,
  uninstall as uninstallService,
  getInstalledPath as getInstalledServicePath,
  detectPlatform,
  ServicePlatformUnsupportedError,
} from './service-installer.js';
import type { ParsedCliArgs, ServiceAction } from '../cli-utils.js';
import { c } from '../utils/colors.js';

/**
 * 取 backend/package.json 版本号；失败兜底 '0.0.0'。
 *
 * 三种入口位置都要兼容：
 *  - 发布 bundle：backend/dist/cli.js          → __dirname/../package.json
 *  - tsc 分散输出：backend/dist/broker/cli.js  → __dirname/../../package.json
 *  - dev tsx：backend/src/broker/cli.ts        → __dirname/../../package.json
 *
 * 简单做法：从 __dirname 向上 3 层找首个 name === 'auvezy-terminal-remote'
 * 的 package.json。三层覆盖以上所有情况，不会上探到 monorepo root。
 */
function getBrokerVersion(): string {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(__dirname, 'package.json'),
    resolve(__dirname, '..', 'package.json'),
    resolve(__dirname, '..', '..', 'package.json'),
  ];
  for (const pkgPath of candidates) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as {
        name?: string;
        version?: string;
      };
      if (pkg.name === 'auvezy-terminal-remote' && typeof pkg.version === 'string') {
        return pkg.version;
      }
    } catch {
      /* 该层没文件 / 不是 JSON，继续下一层 */
    }
  }
  logger.warn({ candidates }, '读取 broker 版本失败，使用 0.0.0 占位');
  return '0.0.0';
}

/**
 * 解析 cli.js 绝对路径（用于 service install 写 ExecStart）。
 *
 * - 发布 bundle：broker/cli.ts 与 cli.ts 都被合到 backend/dist/cli.js → __dirname/cli.js
 * - tsc 分散输出 / dev tsx：broker 与 入口分别在 .../broker/cli.{js,ts} 和
 *   .../cli.{js,ts}，本函数所在文件的 __dirname 上一级才是入口所在目录
 *
 * 这里不做强假设：先试同目录 `cli.js`（bundle）再试上一级（分散 / dev），
 * 取首个真实存在的 .js 文件返回。两条都不在则兜底返同目录 `cli.js`，让
 * 上层（systemd / launchd 启动时）自然报 ENOENT，比这里默默猜更直接。
 */
function getCliPath(): string {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(__dirname, 'cli.js'),
    resolve(__dirname, '..', 'cli.js'),
  ];
  for (const p of candidates) {
    try {
      readFileSync(p);
      return p;
    } catch {
      /* 试下一层 */
    }
  }
  return candidates[0]!;
}

/**
 * dispatch：cli.ts 进入点（service subcommand → 对应 run*）
 *
 * @param cli 完整的 ParsedCliArgs；`atr start` 用其中的 port / host
 */
export async function runServiceCli(
  action: ServiceAction,
  cli: ParsedCliArgs,
): Promise<number> {
  switch (action) {
    case 'start':
      return runBrokerStart(cli);
    case 'stop':
      return runBrokerStop();
    case 'status':
      return runBrokerStatus();
    case 'list':
      return runListInstances();
    case 'install':
      return runServiceInstall();
    case 'uninstall':
      return runServiceUninstall();
    case 'logs':
      return runShowLogs();
  }
}

// ──────────────── start ────────────────

/**
 * 端口解析优先级（高 → 低）：
 *   1. CLI flag `--port <n>`（atr start --port 3010）
 *   2. env `ATR_BROKER_PORT`（service install 写到 systemd unit 的 Environment）
 *   3. 默认 3000
 *
 * host 同理，env 是 `ATR_BROKER_HOST`，默认 0.0.0.0。
 */
async function runBrokerStart(cli: ParsedCliArgs): Promise<number> {
  const port =
    cli.port ??
    parseEnvPort(process.env['ATR_BROKER_PORT']) ??
    DEFAULT_BROKER_PORT;
  const host = cli.host ?? process.env['ATR_BROKER_HOST'] ?? DEFAULT_BROKER_HOST;
  const brokerVersion = getBrokerVersion();

  // 0.7.0 v2：broker 进程自己的 daily log（按天 rotate，保留 7 天）
  // 镜像 process.stderr.write —— logger 通过 stderr 输出，rotator 同步追加文件
  const logRotator = installBrokerLogRotator();
  process.stderr.write(
    `[atr] log file: ${logRotator.currentFilePath()}\n`,
  );

  const registry = new InstanceRegistryManager();
  const __dirname = dirname(fileURLToPath(import.meta.url));
  // bundle 后位于 backend/dist/cli.js，frontend-dist 在 backend/frontend-dist
  const frontendDist = resolve(__dirname, '..', 'frontend-dist');

  // 0.7.0 v2：broker 持有所有"系统级"API 状态依赖
  //
  // 启动顺序：
  //  1. 共享 token（与 worker 共用同一份 ~/.atrrc）
  //  2. 用户 config.json（ConfigStore 的内存源）
  //  3. AuthModule + SessionsStore（共享文件，跨进程会话）
  //  4. PushService（VAPID + push-subscriptions.json）
  //  5. instance watcher（SSE 推送依赖）
  //  6. InstanceSpawner（POST /api/instances 的派生器）
  let sharedToken: string;
  try {
    const r = await acquireSharedToken({
      path: defaultUserConfigPath(),
      generateToken: generateAuthToken,
    });
    sharedToken = r.token;
    logger.info({ source: r.source }, 'broker 共享 token 就绪');
  } catch (err) {
    process.stderr.write(
      `[atr] failed to acquire shared token: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return 1;
  }

  const userCfgLoaded = loadUserConfig();
  let currentUserConfig: UserConfig = userCfgLoaded.value;
  const configStore: ConfigStore = {
    get: () => currentUserConfig,
    set: (value) => {
      saveUserConfig(value, userCfgLoaded.path);
      currentUserConfig = value;
    },
  };

  const sessionsStore = new SessionsStore({ sessionTtlMs: DEFAULT_SESSION_TTL_MS });
  const authModule = new AuthModule({
    token: sharedToken,
    sessionTtlMs: DEFAULT_SESSION_TTL_MS,
    rateLimitPerMinute: DEFAULT_AUTH_RATE_LIMIT,
    cookieName: DEFAULT_SESSION_COOKIE_NAME,
    sessions: sessionsStore,
  });

  const pushService = new PushService();
  await pushService.init();

  // 启动 instances.json watcher：SSE /api/instances/stream 用
  startInstanceWatcher(registry.filePath);

  // Spawner：bundle 后 cli.js 就是 __dirname/cli.js（即本进程入口本身）
  const cliJsPath = resolve(__dirname, 'cli.js');
  // workdir 策略：broker 端不接 CLI flag，从 userConfig 读
  const workdirAllow = currentUserConfig.workdirAllow as readonly string[] | undefined;
  const workdirDeny = currentUserConfig.workdirDeny as readonly string[] | undefined;
  const spawner = new DefaultInstanceSpawner({
    cliJsPath,
    ...(workdirAllow ? { workdirAllow } : {}),
    ...(workdirDeny ? { workdirDeny } : {}),
  });

  // detectDisplayIp 给 share endpoints 用（broker 监 0.0.0.0 时需展示 IP）
  const displayIp = detectDisplayIp(host);

  const brokerApi: BrokerApiDeps = {
    authModule,
    configStore,
    spawner,
    pushService,
    brokerPort: port,
    displayIp,
    workdirPolicy: () => ({
      allow: ((currentUserConfig.workdirAllow as string[] | undefined) ?? []),
    }),
  };

  let handle;
  try {
    handle = await startBrokerServer({
      port,
      host,
      brokerVersion,
      registry,
      frontendDist,
      brokerApi,
    });
  } catch (err) {
    process.stderr.write(
      `[atr] startup failed: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return 1;
  }

  process.stderr.write(
    `[atr] listening on http://${host}:${handle.port}\n`,
  );

  let stopping = false;
  const stop = async (signal: string): Promise<void> => {
    if (stopping) return;
    stopping = true;
    logger.info({ signal }, 'broker 收到退出信号');
    stopInstanceWatcher();
    authModule.destroy();
    await handle.shutdown();
    logRotator.close();
    process.exit(0);
  };
  process.once('SIGINT', () => void stop('SIGINT'));
  process.once('SIGTERM', () => void stop('SIGTERM'));

  await new Promise<void>(() => {
    /* never resolves */
  });
  return 0; // unreachable
}

/**
 * 给 broker 进程装 daily-rotate log 文件 writer，并镜像 process.stderr.write
 * 进文件。
 *
 * 镜像策略（不接管，只增写）：
 *   写 stderr 时同步 appendFile 到当天的 broker-YYYY-MM-DD.log。systemd /
 *   launchd 接管 stderr 给 journal/log 不受影响——只是多落一份本地文件。
 *
 * 文件位置：~/.auvezy/terminal-remote/broker-YYYY-MM-DD.log
 *   （与 config.json / instances.json 同目录，便于排错时一处定位）
 */
function installBrokerLogRotator(): BrokerLogRotator {
  const dir = resolve(homedir(), ATR_DATA_DIR);
  const rotator = createBrokerLogRotator({ dir });
  // 拦 process.stderr.write —— 保留原始返回值 / encoding 行为
  const originalWrite = process.stderr.write.bind(process.stderr) as (
    chunk: unknown,
    ...rest: unknown[]
  ) => boolean;
  process.stderr.write = ((chunk: unknown, ...rest: unknown[]): boolean => {
    try {
      const text =
        typeof chunk === 'string'
          ? chunk
          : Buffer.isBuffer(chunk)
            ? chunk.toString('utf-8')
            : String(chunk);
      rotator.write(text);
    } catch {
      /* rotator 失败不影响原始 stderr */
    }
    return originalWrite(chunk as never, ...(rest as []));
  }) as typeof process.stderr.write;
  return rotator;
}

// ──────────────── stop ────────────────

const STOP_GRACE_MS = 5_000;
const STOP_POLL_INTERVAL_MS = 100;

async function runBrokerStop(): Promise<number> {
  const tag = c.cyan('[atr]');
  const state = readBrokerState();
  if (!state) {
    process.stdout.write(`${tag} not running (broker.json missing)\n`);
    return 0;
  }
  if (!isBrokerAlive(state)) {
    process.stdout.write(
      `${tag} PID ${state.pid} is dead; cleaning up broker.json\n`,
    );
    clearBrokerState();
    return 0;
  }

  process.stdout.write(`${tag} sending SIGTERM to PID ${state.pid}\n`);
  try {
    process.kill(state.pid, 'SIGTERM');
  } catch (err) {
    process.stderr.write(
      `${c.red('[atr]')} SIGTERM failed: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return 1;
  }

  // 等优雅退出
  const t0 = Date.now();
  while (Date.now() - t0 < STOP_GRACE_MS) {
    if (!isBrokerAlive(readBrokerState())) {
      process.stdout.write(`${tag} ${c.green('stopped')}\n`);
      clearBrokerState();
      return 0;
    }
    await sleep(STOP_POLL_INTERVAL_MS);
  }

  // 超时强杀
  process.stdout.write(`${tag} ${c.yellow('graceful shutdown timed out')}; sending SIGKILL\n`);
  try {
    process.kill(state.pid, 'SIGKILL');
  } catch {
    /* 已死 */
  }
  clearBrokerState();
  return 0;
}

// ──────────────── status ────────────────

/**
 * 一屏看清整个 atr 服务状态。分 4 段输出：
 *   1. broker 进程：pid / port / host / 版本 / uptime / 自启服务激活状态
 *   2. token：从 ~/.atrrc 读取（broker 与 worker 共享同一份）
 *   3. 入口清单：所有可达的访问 URL（默认入口标 ★，含 token query）
 *   4. 实例：count + 简表
 *
 * 退出码：broker alive + health probe 通 → 0；任一失败 → 1
 */
async function runBrokerStatus(): Promise<number> {
  const state = readBrokerState();

  // ── section 1: service process ──
  process.stdout.write(c.bold('=== Service ===\n'));
  if (!state) {
    process.stdout.write(`  status:  ${c.yellow('not running')} (broker.json missing)\n`);
    process.stdout.write(`  ${c.dim('hint:    atr start to launch; atr install to register autostart')}\n\n`);
    // still print "autostart" / "token" sections to give the full picture
    writeServiceInstallSection();
    await writeTokenSection();
    return 1;
  }
  const alive = isBrokerAlive(state);
  process.stdout.write(
    [
      `  status:  ${alive ? c.green('running') : c.red('dead (stale state)')}`,
      `  pid:     ${state.pid}`,
      `  port:    ${state.port}`,
      `  host:    ${state.host}`,
      `  version: ${state.brokerVersion}`,
      `  started: ${new Date(state.startedAt).toISOString()}`,
      `  state:   ${defaultBrokerStatePath()}`,
    ].join('\n') + '\n',
  );

  let healthOk = false;
  let uptimeMs = 0;
  if (alive) {
    try {
      const url = `http://${state.host === '0.0.0.0' ? '127.0.0.1' : state.host}:${state.port}/api/health`;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 2000);
      try {
        const r = await fetch(url, { signal: ctrl.signal });
        const body = (await r.json()) as { ok?: boolean; uptimeMs?: number };
        healthOk = r.ok && body.ok === true;
        uptimeMs = body.uptimeMs ?? 0;
        process.stdout.write(
          `  health:  ${r.status} ok=${body.ok ?? '?'} uptime=${formatUptime(uptimeMs)}\n`,
        );
      } finally {
        clearTimeout(timer);
      }
    } catch (err) {
      process.stdout.write(
        `  health:  probe failed: ${err instanceof Error ? err.message : String(err)}\n`,
      );
    }
  }
  process.stdout.write('\n');

  // ── section 2: autostart service ──
  writeServiceInstallSection();

  // ── section 3: token ──
  await writeTokenSection();

  // ── section 4: entry URLs (only meaningful when broker is alive) ──
  if (alive) {
    await writeEntriesSection(state.port);
  }

  // ── section 5: instances ──
  await writeInstancesSection();

  return alive && healthOk ? 0 : 1;
}

/** Format milliseconds to "1d 2h 3m 4s" (skip leading zero parts). */
function formatUptime(ms: number): string {
  if (ms <= 0) return '0s';
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const parts: string[] = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0 || d > 0) parts.push(`${h}h`);
  if (m > 0 || h > 0 || d > 0) parts.push(`${m}m`);
  parts.push(`${sec}s`);
  return parts.join(' ');
}

/** Section: autostart (systemd / launchd) state. */
function writeServiceInstallSection(): void {
  process.stdout.write(c.bold('=== Autostart ===\n'));
  const platformDetected = detectPlatform();
  const installed = getInstalledServicePath();
  process.stdout.write(`  platform: ${platformDetected}\n`);
  process.stdout.write(
    `  config:   ${installed ?? '(not installed; run atr install to register)'}\n`,
  );
  if (!installed) {
    process.stdout.write('\n');
    return;
  }
  if (platformDetected === 'linux' || platformDetected === 'wsl2') {
    try {
      const out = execSync('systemctl --user is-active atr-broker.service', {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      process.stdout.write(`  systemd:  ${out.trim()}\n`);
    } catch (err) {
      const e = err as { stdout?: Buffer | string; stderr?: Buffer | string };
      const msg =
        String(e.stdout ?? '').trim() || String(e.stderr ?? '').trim() || 'unknown';
      process.stdout.write(`  systemd:  ${msg}\n`);
    }
  } else if (platformDetected === 'macos') {
    try {
      const out = execSync('launchctl list | grep atr-broker || true', {
        encoding: 'utf-8',
        shell: '/bin/sh',
      });
      process.stdout.write(
        `  launchd:  ${out.trim() ? out.trim() : 'not loaded'}\n`,
      );
    } catch {
      process.stdout.write('  launchd:  query failed\n');
    }
  }
  process.stdout.write('\n');
}

/** Section: token (read from ~/.atrrc; full display — local view, same risk as .atrrc itself). */
async function writeTokenSection(): Promise<void> {
  process.stdout.write(c.bold('=== Token ===\n'));
  try {
    const { readFileSync, statSync } = await import('node:fs');
    const { resolve: pathResolve } = await import('node:path');
    const { homedir } = await import('node:os');
    const path = pathResolve(homedir(), '.atrrc');
    const stat = statSync(path);
    const cfg = JSON.parse(readFileSync(path, 'utf-8')) as { token?: unknown };
    if (typeof cfg.token === 'string' && cfg.token.length > 0) {
      process.stdout.write(`  token:   ${cfg.token}\n`);
      process.stdout.write(
        `  file:    ${path} (mode ${(stat.mode & 0o777).toString(8)})\n`,
      );
    } else {
      process.stdout.write(`  token:   (none; ${path} has no .token field)\n`);
    }
  } catch (err) {
    process.stdout.write(
      `  token:   read failed: ${err instanceof Error ? err.message : String(err)}\n`,
    );
  }
  process.stdout.write('\n');
}

/**
 * Section: entry URLs.
 *
 * Lists every reachable URL (each carrying ?token= for one-click login).
 * The default entry is starred (★). Paste any of these into a browser.
 */
async function writeEntriesSection(brokerPort: number): Promise<void> {
  process.stdout.write(c.bold('=== Entry URLs (paste into a browser) ===\n'));
  try {
    const { discoverEntries, kindLabel } = await import('./entry-discovery.js');
    // Token is only injected if readable from ~/.atrrc; otherwise URLs go without ?token=
    let token: string | undefined;
    try {
      const { readFileSync } = await import('node:fs');
      const { resolve: pathResolve } = await import('node:path');
      const { homedir } = await import('node:os');
      const cfg = JSON.parse(
        readFileSync(pathResolve(homedir(), '.atrrc'), 'utf-8'),
      ) as { token?: unknown };
      if (typeof cfg.token === 'string' && cfg.token.length > 0) token = cfg.token;
    } catch {
      /* unreadable → no token in URL */
    }
    // discoverEntries needs an instanceId to compose /i/<id>/, but here we want the
    // broker root URL (pre-instance entry view). We re-compose http://<host>:<port>/
    // ourselves below; the placeholder only helps discoverEntries with sorting.
    const candidates = discoverEntries({
      brokerPort,
      instanceId: '__placeholder__',
      ...(token ? { token } : {}),
    });
    if (candidates.length === 0) {
      process.stdout.write('  (no reachable entries)\n\n');
      return;
    }
    for (const c of candidates) {
      const isIpv6 = c.host.includes(':') && !c.host.startsWith('[');
      const hostPart = isIpv6 ? `[${c.host}]` : c.host;
      const url = token
        ? `http://${hostPart}:${c.port}/?token=${encodeURIComponent(token)}`
        : `http://${hostPart}:${c.port}/`;
      const star = c.isDefault ? ' ★' : '  ';
      const tag = `[${kindLabel(c.kind)}]`.padEnd(10, ' ');
      process.stdout.write(`  ${star} ${tag} ${url}\n`);
    }
  } catch (err) {
    process.stdout.write(
      `  (failed to list entry URLs: ${err instanceof Error ? err.message : String(err)})\n`,
    );
  }
  process.stdout.write('\n');
}

/** Section: instances. */
async function writeInstancesSection(): Promise<void> {
  process.stdout.write(c.bold('=== Instances ===\n'));
  try {
    const { InstanceRegistryManager } = await import('../registry/instance-registry.js');
    const registry = new InstanceRegistryManager();
    const list = await registry.list();
    process.stdout.write(`  count:   ${list.length}\n`);
    if (list.length === 0) {
      process.stdout.write(
        '  (none; create one in the webapp via "+ New instance", or run atr [program])\n',
      );
    } else {
      for (const i of list) {
        process.stdout.write(
          `  - ${i.name.padEnd(20).slice(0, 20)} pid=${String(i.pid).padEnd(6)} port=${i.port}  cwd=${i.cwd}\n`,
        );
      }
      process.stdout.write('  (full table: atr list)\n');
    }
  } catch (err) {
    process.stdout.write(
      `  (failed to load instances: ${err instanceof Error ? err.message : String(err)})\n`,
    );
  }
  process.stdout.write('\n');
}

// ──────────────── list / logs（实例列表 / broker 日志） ────────────────

async function runListInstances(): Promise<number> {
  const { listInstancesCli } = await import('../registry/cli-list.js');
  return listInstancesCli();
}

/**
 * tail 当前 broker 进程的当天 log 文件
 *
 * 文件路径：~/.atr/broker-YYYY-MM-DD.log（按天 rotate，保留 7 天）
 * 行为：spawn `tail -F <file>`，让用户 Ctrl+C 退出。Windows 上 tail 不存在
 * 时降级为 cat 一次性输出 + 提示。
 */
async function runShowLogs(): Promise<number> {
  const { homedir } = await import('node:os');
  const { resolve: pathResolve } = await import('node:path');
  const { existsSync } = await import('node:fs');
  const { spawn } = await import('node:child_process');
  const today = new Date();
  const day =
    `${today.getFullYear()}-` +
    `${String(today.getMonth() + 1).padStart(2, '0')}-` +
    `${String(today.getDate()).padStart(2, '0')}`;
  const logPath = pathResolve(homedir(), '.atr', `broker-${day}.log`);

  if (!existsSync(logPath)) {
    process.stderr.write(
      `[atr] today's log not found: ${logPath}\n` +
        'hint: is the service running? try atr status, or atr start to launch.\n',
    );
    return 1;
  }

  process.stderr.write(`[atr] tail -F ${logPath} (Ctrl+C to quit)\n`);
  // tail -F follows the file across rotation (supported by GNU tail and BSD tail)
  const tail = spawn('tail', ['-F', logPath], { stdio: 'inherit' });
  return new Promise<number>((resolveExit) => {
    tail.on('error', (err) => {
      // Fallback for minimal environments without tail: one-shot cat-equivalent.
      process.stderr.write(
        `[atr] cannot spawn tail (${err.message}); falling back to one-shot output:\n`,
      );
      void import('node:fs').then(({ readFileSync }) => {
        try {
          process.stdout.write(readFileSync(logPath, 'utf-8'));
          resolveExit(0);
        } catch (e) {
          process.stderr.write(`[atr] failed to read log: ${(e as Error).message}\n`);
          resolveExit(1);
        }
      });
    });
    tail.on('exit', (code) => resolveExit(code ?? 0));
  });
}

// ──────────────── service install / uninstall ────────────────

function runServiceInstall(): number {
  const cliPath = getCliPath();
  const nodeBin = process.execPath;

  try {
    const r = installService({ nodeBin, cliPath });
    process.stdout.write(
      [
        `${c.cyan('[atr]')} platform: ${r.platform}`,
        `${c.cyan('[atr]')} ${c.green('wrote:')}    ${r.servicePath}`,
        '',
        c.bold('Next steps (run in order):'),
        ...r.nextSteps.map((s) => `  ${c.dim(s)}`),
        '',
      ].join('\n'),
    );
    return 0;
  } catch (err) {
    if (err instanceof ServicePlatformUnsupportedError) {
      process.stderr.write(`${c.red('[atr]')} ${err.message}\n`);
      return 2;
    }
    process.stderr.write(
      `${c.red('[atr]')} install failed: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return 1;
  }
}

async function runServiceUninstall(): Promise<number> {
  // 二次确认 —— 这一步会删 systemd unit / launchd plist 文件,误删后用户得
  // 重新 install + 跑 daemon-reload。给次询问值得。
  // 非 TTY(脚本 / CI):自动放过(认为调用方知道自己在干嘛);要在 CI 拒就 NO_COLOR=1 不
  // 影响,真要拒得加 --yes flag 才稳 —— 0.7.x 暂不引入。
  const { getInstalledPath: getInstalledForConfirm } = await import('./service-installer.js');
  const installedPath = getInstalledForConfirm();
  if (installedPath) {
    const { confirm } = await import('../utils/confirm-prompt.js');
    const ok = await confirm({
      message: `Remove autostart service file at ${installedPath}?`,
      initial: false,
      nonInteractiveDefault: true,
    });
    if (!ok) {
      process.stdout.write(`${c.dim('[atr] uninstall cancelled')}\n`);
      return 0;
    }
  }
  try {
    const r = uninstallService();
    process.stdout.write(
      [
        `${c.cyan('[atr]')} platform: ${r.platform}`,
        r.removed
          ? `${c.cyan('[atr]')} ${c.green('removed:')}  ${r.servicePath}`
          : `${c.cyan('[atr]')} ${c.yellow('not found:')} ${r.servicePath} (nothing to remove)`,
        '',
        c.bold('Next steps:'),
        ...r.nextSteps.map((s) => `  ${c.dim(s)}`),
        '',
      ].join('\n'),
    );
    return 0;
  } catch (err) {
    if (err instanceof ServicePlatformUnsupportedError) {
      process.stderr.write(`${c.red('[atr]')} ${err.message}\n`);
      return 2;
    }
    process.stderr.write(
      `${c.red('[atr]')} uninstall failed: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return 1;
  }
}

// ──────────────── 工具 ────────────────

function parseEnvPort(raw: string | undefined): number | null {
  if (!raw) return null;
  const n = Number.parseInt(raw, 10);
  if (!Number.isInteger(n) || n <= 0 || n > 65535) return null;
  return n;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
