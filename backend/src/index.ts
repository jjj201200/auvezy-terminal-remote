/**
 * Backend worker 服务入口（0.7.0 起 worker only，broker 在 broker/cli.ts）
 *
 * 启动流程：
 *  1. loadConfig（CLI > env > config.json > 默认）→ AppConfig
 *  1.4 共享 Token：cli/env 都没指定时，走 acquireSharedToken（withFileLock）
 *  1.5 解析用户 --settings + 合并 atr hooks → 写 settings 文件
 *  1.6 detectDisplayIp（仅给 brokerEntryUrl 兜底 + share-routes 兼容）
 *  1.7 ensureBroker：broker 不在则 fork（ADR-001/002）；拿到 broker.json
 *  1.8 多实例：bindAvailablePort 强制 127.0.0.1（ADR-009）+ 生成 instanceId
 *  2. AuthModule（共享 SessionsStore，cookie 名 session_id 不再带端口后缀）
 *  3. Express + CORS + /api 路由（含 /auth + /config + /hook + /instances + /push + /share）
 *  4. 静态前端 + SPA fallback
 *  5. HttpServer + WsServer
 *  6. PtyManager + SessionController（push payload fallback url=brokerEntryUrl）
 *     + 条件 TerminalRelay
 *  7. spawn → setStatus(running)
 *  7.5 注册到 instances.json（host=127.0.0.1，broker 反代时直读）
 *  8. SIGINT/SIGTERM/双 Ctrl+C/PTY exit/EADDRINUSE → shutdown（同步注销实例）
 *  9. listen 后打印 banner（broker 入口 URL + ASCII QR）
 */

import { createServer, type Server as HttpServer } from 'node:http';
import { execSync } from 'node:child_process';
import { networkInterfaces } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import { ErrorCode } from 'auvezy-terminal-remote-shared';
import { logger } from './logger/logger.js';
import { createWorkerApiRouter } from './api/router.js';
import { PtyManager } from './pty/pty-manager.js';
import { WsServer } from './ws/ws-server.js';
import { SessionController } from './session/session-controller.js';
import { TerminalRelay } from './terminal/terminal-relay.js';
import {
  AuthModule,
  createSessionCookieName,
  DEFAULT_SESSION_COOKIE_NAME,
} from './auth/auth-middleware.js';
import { SessionsStore } from './sessions/sessions-store.js';
import { generateToken } from './auth/token-generator.js';
import { createWsAuthenticate } from './auth/ws-authenticate.js';
import {
  extractSettingsFromArgs,
  loadConfig,
  type AppConfig,
} from './config.js';
import { IntegrationManager, DEFAULT_INTEGRATION_PREFS } from './integrations/manager.js';
import { ClaudeCodeIntegration } from './integrations/claude-code/index.js';
import type { ParsedCliArgs } from './cli-utils.js';
import { acquireSharedToken } from './registry/shared-token.js';
import { bindAvailablePort } from './registry/port-finder.js';
import { InstanceError } from './errors.js';
import { InstanceRegistryManager } from './registry/instance-registry.js';
import { detectDisplayIp } from './utils/network.js';
import { renderQrCode } from './utils/qrcode-banner.js';
// IpMonitor 在 0.7.0 worker 路径下移除（ADR-009：worker 只听 loopback，本机 IP
// 变化与 worker 无关；对外入口由 broker 决定，IP 监控应在 broker 端做——阶段 3）
import { PushService } from './push/push-service.js';
import { createDevProxy, type DevProxyHandle } from './dev/dev-proxy.js';
import { randomUUID } from 'node:crypto';
import {
  SHUTDOWN_WS_FLUSH_DELAY_MS,
  SHUTDOWN_FORCE_EXIT_MS,
  JSON_BODY_LIMIT_WORKER,
} from './constants.js';

export interface StartServerOverrides {
  /** 来自 cli.ts parseCliArgs 的解析结果；不传则使用空 ParsedCliArgs */
  cli?: ParsedCliArgs;
  /** 兼容老用法：直接传 port/token，覆盖 cli 中的对应字段（仅用于测试） */
  port?: number;
  token?: string;
}

export async function startServer(overrides: StartServerOverrides = {}): Promise<void> {
  // 1. 配置加载（CLI > env > config.json > 默认）
  const cli: ParsedCliArgs = overrides.cli ?? { subcommand: 'pty', claudeArgs: [] };
  // 老用法的便捷覆盖：保持阶段 1/2 测试不需要重写
  if (overrides.port !== undefined) cli.port = overrides.port;
  if (overrides.token !== undefined) cli.token = overrides.token;

  const cfg: AppConfig = loadConfig({
    cli,
    env: process.env,
    generateToken,
  });

  // 1.4 共享 Token：仅当 loadConfig 走的是 'generated' 路径时（cli/env 都没指定）
  //    才用 shared-token 取代——这样多实例之间能复用同一个 token，二维码不会
  //    随启动顺序变。cli/env 显式指定时尊重用户意图。
  if (cfg.tokenSource === 'generated') {
    try {
      const r = await acquireSharedToken({
        path: cfg.userConfigPath,
        generateToken,
      });
      cfg.token = r.token;
      cfg.tokenSource = r.source; // 'shared' 或 'generated'
    } catch (err) {
      // 锁超时或文件 IO 失败：保留 generated token 继续运行（用户可能跨实例 token 不一致，但服务能起）
      logger.warn({ err }, 'shared-token 获取失败，回退到本进程随机 token');
    }
  }

  // 1.6 displayIp（0.7.0 仅 2 个用途）：
  //   - broker 监 0.0.0.0 时给 brokerEntryUrl 拼一个 hostname（不能写 0.0.0.0）
  //   - share-routes 兼容字段（阶段 3 share endpoints 迁移到 broker 后会删）
  //   worker 自己不再用它生成任何对外 URL
  const displayIp = detectDisplayIp(cfg.host);
  // 0.7.0：broker spawn worker 时通过 env `ATR_INSTANCE_ID` 透传 instanceId，
  // 让 webapp 提前拿到 id 订阅 SSE / 拼 /i/<id>/ws。env 没有才本地 randomUUID
  // （用户手动 `atr claude` 启的场景）。
  const instanceId = process.env['ATR_INSTANCE_ID'] ?? randomUUID();

  // 1.65 校验 PTY program 在 PATH 上可找到。**必须在 ensureBroker 之前**——
  // 否则 broker 已经被拉起 / instances.json 写入 / PTY spawn 才报 ENOENT，留下
  // 脏状态。`atr foo-not-exists` 应当立即失败、什么都不动。
  //
  // 仅当用户**显式指定** program（cli.command 非 undefined）时校验；走默认 $SHELL
  // 时不校验（resolveDefaultShell 已挑了实际存在的 shell）。
  let usedShellFallback = false; // program 经 fallback 改写成 $SHELL -ic(integration detect 需要此信号)
  if (cli.command !== undefined) {
    const { resolveExecutable, listPathExecutables } = await import('./utils/resolve-executable.js');
    const resolved = resolveExecutable(cfg.claudeCommand);
    if (!resolved) {
      const { c } = await import('./utils/colors.js');
      // 含 / 时是路径错,不可能是 shell 函数(函数只以纯名字调用)——直接 127
      if (cfg.claudeCommand.includes('/')) {
        process.stderr.write(
          `${c.red('[atr]')} command not found: ${cfg.claudeCommand}\n`
          + c.dim('hint: file does not exist or is not executable; check the path and permissions')
          + '\n',
        );
        process.exit(127);
      }

      // 纯名字:先看是不是拼错的保留 subcommand(优先级高于函数 fallback)——
      // 用户拼错 `atr stp` 想的多半是 `atr stop`,而不是 zshrc 里的函数
      let subGuess: string | null = null;
      try {
        const { suggest } = await import('./utils/did-you-mean.js');
        const { RESERVED_SUBCOMMANDS } = await import('./cli-utils.js');
        subGuess = suggest(cfg.claudeCommand, {
          candidates: Array.from(RESERVED_SUBCOMMANDS),
          threshold: 0.6,
        });
      } catch {
        /* 建议失败不影响主流程 */
      }
      if (subGuess) {
        process.stderr.write(
          `${c.red('[atr]')} command not found: ${cfg.claudeCommand}\n`
          + `  did you mean: ${c.cyan(`atr ${subGuess}`)}?\n`,
        );
        process.exit(127);
      }

      // 既不在 PATH 也不是拼错的 subcommand → 大概率是 shell 函数/alias
      // (如用户 .zshrc 里定义的 zclaude)。node-pty 走 execvp 语义无法解析,
      // 改写为 `$SHELL -ic '<命令行>'` 让交互 shell 加载 rc 后执行——
      // 函数、alias、rc 里的 export(典型:claude 的 API 网关变量)全部生效。
      // 集成不丢:viaShellFallback 让 claude-code 模块照常激活,hooks 经
      // CLAUDE_CONFIG_DIR 镜像注入(与命令名/参数转发无关)。
      const { buildInteractiveFallback } = await import('./utils/shell-function-fallback.js');
      const fb = buildInteractiveFallback(cfg.claudeCommand, cfg.claudeArgs);
      if (fb) {
        process.stderr.write(
          `${c.yellow('[atr]')} '${cfg.claudeCommand}' is not on PATH — retrying as a shell function/alias via ${fb.command} -ic\n`,
        );
        logger.info(
          { original: cfg.claudeCommand, shell: fb.command, cmdline: fb.args[1] },
          'program 不在 PATH,fallback 到交互 shell 执行(函数/alias 场景)',
        );
        usedShellFallback = true;
        cfg.claudeCommand = fb.command;
        cfg.claudeArgs = fb.args;
      } else {
        // 无法 fallback(Windows / 无 $SHELL):维持原 127 + 拼写建议
        const lines: string[] = [
          `${c.red('[atr]')} command not found: ${cfg.claudeCommand}`,
        ];
        try {
          const { suggest } = await import('./utils/did-you-mean.js');
          const candidates = listPathExecutables();
          const guess = suggest(cfg.claudeCommand, { candidates, threshold: 0.6 });
          if (guess) {
            lines.push(`  did you mean: ${c.cyan(guess)}?`);
          }
        } catch {
          /* 建议失败不影响 127 */
        }
        lines.push(
          c.dim(`hint: check spelling, or use an absolute path (e.g. /usr/bin/${cfg.claudeCommand})`),
        );
        process.stderr.write(lines.join('\n') + '\n');
        process.exit(127); // 127 = standard "command not found" exit code
      }
    } else {
      logger.info({ requested: cfg.claudeCommand, resolved }, 'PTY program resolved');
    }
  }

  // 1.7 ensureBroker（0.7.0 ADR-001/002）：worker 启动前先保证 broker 存在；
  //     fork 失败 → 整个 worker 启动失败（不降级，broker 不在 = 没人能访问 webapp）
  //
  // `--port` 在 atr [program] 路径下语义 = "broker 期望端口"——worker 端口是
  // 内部细节（loopback only，broker 反代查 instances.json 拿），用户不该 care。
  const __dirnameForBroker = dirname(fileURLToPath(import.meta.url));
  const cliJsPathForBroker = resolve(__dirnameForBroker, 'cli.js');
  const { ensureBroker } = await import('./broker/index.js');
  let brokerState: import('./broker/index.js').BrokerState;
  try {
    const r = await ensureBroker({
      cliJsPath: cliJsPathForBroker,
      ...(cli.port !== undefined ? { brokerPort: cli.port } : {}),
    });
    brokerState = r.state;
    logger.info(
      { brokerPort: brokerState.port, brokerHost: brokerState.host, forked: r.forked },
      'broker 就绪',
    );
  } catch (err) {
    process.stderr.write(
      `[atr] failed to start the background service: ${err instanceof Error ? err.message : String(err)}\n`
        + `hint: check whether ~/.atr/broker.json is held by a stale process; set ATR_DEBUG_SPAWN=1 and retry to capture /tmp/atr-broker-*.log\n`,
    );
    process.exit(1);
    throw err; // 让 TS 把 brokerState 之后的 use 视为 reachable 时已赋值
  }

  // 1.8 IP 监控（0.7.0 阶段 2D 移除）
  //   worker 只听 loopback（ADR-009），本机 IP 变化与 worker 无关；对外入口由
  //   broker 决定，IP 监控应在 broker 端做（阶段 3 落地）。0.6.x 时这里会广播
  //   ip_changed 让前端重算二维码——0.7.0 二维码 URL 由 broker 决定，不再有此需求

  // 1.9 PushService（worker 端只做 reader + sendNotification）
  //
  // 0.7.0 v2 起订阅 CRUD 由 broker 端的 /api/push/subscriptions 处理；worker
  // 仅在 SessionController 检测到 hook 事件时调 PushService.notifyAll 推送。
  // 但订阅文件由 broker 写入 → worker 内存缓存可能 stale，notifyAll 前
  // SessionController 会让 PushService.reloadSubscriptions() 一次（轻成本）。
  const pushService = new PushService();
  await pushService.init();

  const app = express();
  // worker 顶层 JSON 上限见 constants.ts JSON_BODY_LIMIT_WORKER —— 10mb 给
  // hook 留足空间,不像之前 100mb 那样把整个 buffer 攻击面打开
  app.use(express.json({ limit: JSON_BODY_LIMIT_WORKER }));
  const httpServer: HttpServer = createServer(app);

  // 1.11 bindAvailablePort：worker 0.7.0 起强制 loopback（ADR-009）
  //
  // - cfg.host 仅作为日志提示展示，不参与 listen
  // - probe 与 listen 用 127.0.0.1：本机 worker 只接受 broker 的 loopback 连接
  // - 0.7.0 v2 起 worker 端口由 OS 自动分配（preferred=0）：worker 端口是
  //   内部细节（broker 反代查 instances.json 拿真实 port），用户不该指定。
  //   `cli.port` 在 atr [program] 路径下专门给 broker 用（见 ensureBroker），
  //   worker 这里不再消费它。
  const WORKER_LISTEN_HOST = '127.0.0.1';
  if (cfg.host !== WORKER_LISTEN_HOST && cfg.host !== 'localhost') {
    logger.warn(
      { configuredHost: cfg.host },
      `0.7.0 worker 强制只听 ${WORKER_LISTEN_HOST}（ADR-009）；--host ${cfg.host} 已忽略`,
    );
  }
  let bindResult;
  try {
    bindResult = await bindAvailablePort({
      preferred: 0, // OS auto-pick a free high port
      host: WORKER_LISTEN_HOST,
      server: httpServer,
      strict: false,
    });
  } catch (err) {
    if (err instanceof InstanceError && err.code === ErrorCode.PORT_UNAVAILABLE) {
      process.stderr.write(`atr: ${err.message}\n`);
      process.exit(1);
    }
    throw err;
  }
  cfg.port = bindResult.port;
  // broker 入口 URL（banner 展示 / push payload fallback 用；外部用户实际访问
  // 的入口由 broker 在反代时通过 X-ATR-Forwarded-* 头告诉每个订阅者，故 fallback
  // 才是这个值——绝大多数路径都已经被 entry-url-aware 替换掉）
  const brokerEntryUrl = `http://${brokerState.host === '0.0.0.0' ? displayIp : brokerState.host}:${brokerState.port}/i/${instanceId}/`;

  logger.info(
    {
      port: cfg.port,
      host: cfg.host,
      displayIp,
      claudeCommand: cfg.claudeCommand,
      claudeCwd: cfg.claudeCwd,
      claudeArgs: cfg.claudeArgs,
      instanceName: cfg.instanceName,
      tokenSource: cfg.tokenSource,
      userConfigPath: cfg.userConfigPath,
      strictPort: cfg.strictPort,
    },
    '加载阶段 5 配置',
  );

  // 1.5 Integrations:可热插拔的"识别原终端工具上下文"模块体系
  //
  // - IntegrationManager 持有所有已注册模块,在 spawn 阶段调用 detect 决定激活
  //   哪个;hook payload 到达时由 manager 路由给激活模块翻译成 IntegrationEvent
  // - 当前只内置 ClaudeCodeIntegration:detect=basename 是 claude;激活时给 spawn
  //   注入 --settings <写好的 hooks 文件路径>
  // - 用户偏好(总开关 / forceModule / 事件细分)从 cfg.userConfig.integrations 读
  const extracted = extractSettingsFromArgs(cfg.claudeArgs);
  const finalClaudeArgs = extracted ? extracted.remainingArgs : [...cfg.claudeArgs];

  // ensureDefaultUserConfig 会填默认,但类型层面 integrations 仍是 Partial,这里收拢为完整结构
  const rawIntegrations = cfg.userConfig.integrations;
  const integrationPrefs = {
    enabled: rawIntegrations?.enabled ?? DEFAULT_INTEGRATION_PREFS.enabled,
    forceModule: rawIntegrations?.forceModule ?? DEFAULT_INTEGRATION_PREFS.forceModule,
    perModule: rawIntegrations?.perModule ?? DEFAULT_INTEGRATION_PREFS.perModule,
  };
  const integrations = new IntegrationManager(integrationPrefs);
  // 注册具体模块。新增模块在此一行加 register 即可
  const ccPerModule =
    typeof integrationPrefs.perModule === 'object' && integrationPrefs.perModule !== null
      ? (integrationPrefs.perModule as Record<string, unknown>)['claude-code']
      : undefined;
  const ccEvents =
    ccPerModule && typeof ccPerModule === 'object' && 'events' in ccPerModule
      ? ((ccPerModule as { events?: unknown }).events as
          | import('./integrations/claude-code/index.js').ClaudeCodeEventToggles
          | undefined)
      : undefined;
  integrations.register(
    new ClaudeCodeIntegration({
      ...(ccEvents ? { events: ccEvents } : {}),
      ...(extracted?.value ? { existingSettings: extracted.value } : {}),
    }),
  );

  const aug = integrations.prepareSpawn({
    command: cfg.claudeCommand,
    args: finalClaudeArgs,
    port: cfg.port,
    ...(usedShellFallback ? { viaShellFallback: true } : {}),
  });
  /** PTY spawn 的额外 env(集成模块注入,如 CLAUDE_CONFIG_DIR 镜像) */
  let ptyExtraEnv: Record<string, string> | undefined;
  if (aug) {
    if (aug.extraArgs && aug.extraArgs.length > 0) {
      finalClaudeArgs.push(...aug.extraArgs);
    }
    if (aug.extraEnv && Object.keys(aug.extraEnv).length > 0) {
      ptyExtraEnv = aug.extraEnv;
    }
  } else {
    logger.info(
      { command: cfg.claudeCommand, activeIntegration: integrations.activeId },
      'integrations: 未激活任何模块或模块无 spawn 增强(子进程不会自动调用 hook)',
    );
  }

  // 2. AuthModule（0.7.0：共享 SessionsStore；cookie 名统一 session_id；
  //    旧 session_id_p<port> 仍然识别一段时间，避免升级时已签 cookie 全失效）
  const sessionsStore = new SessionsStore({ sessionTtlMs: cfg.sessionTtlMs });
  const authModule = new AuthModule({
    token: cfg.token,
    sessionTtlMs: cfg.sessionTtlMs,
    rateLimitPerMinute: cfg.authRateLimit,
    cookieName: DEFAULT_SESSION_COOKIE_NAME,
    legacyCookieNames: [createSessionCookieName(cfg.port)],
    sessions: sessionsStore,
  });

  // 2.6 注册表（worker 仅用于 self-register / unregister）
  //
  // ConfigStore / spawner / instances watcher / selfShutdown 都已迁到 broker
  // 端（API 归属重划分，见 docs/plans/path-routing/design-v2-api-ownership.md）。
  // worker 收窄：用户配置读写、实例派生、SSE 推送都不再经 worker。
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const registry = new InstanceRegistryManager();

  // 3. Express 路由（app + httpServer 已在 1.10 创建并 listen，这里只往同一个 app 上挂中间件/路由）
  // CORS：同源 + localhost/127.0.0.1 + 本机所有网卡 IP（含 Tailscale / VPN / 多网卡）
  // 之所以放开本机所有网卡 IP：用户可能从 LAN IP / Tailscale IP / 临时 VPN
  // IP 等不同入口访问，统一以"对端能 TCP 连到我们"作为信任前提（防火墙
  // / Tailscale 已经在更外层拦截了不可信源）。
  const localHostnames = collectLocalHostnames();
  logger.info({ hostnames: Array.from(localHostnames) }, 'CORS 白名单');
  app.use(
    cors({
      origin: (origin, callback) => {
        // 同源（无 origin）一律允许
        if (!origin) {
          callback(null, true);
          return;
        }
        try {
          const url = new URL(origin);
          if (localHostnames.has(url.hostname)) {
            callback(null, true);
            return;
          }
        } catch {
          // 无效 origin 忽略走拒绝路径
        }
        callback(new Error('CORS 拒绝：origin 不在白名单'));
      },
      credentials: true,
    }),
  );

  // /api 路由（worker 端：仅 health + hook，其余迁到 broker）
  app.use('/api', createWorkerApiRouter({ integrations }));

  // dev 反代：当 --dev-proxy <port> / ATR_DEV_PROXY 设置时，把非 /api、/ws 的
  // HTTP/WS 请求转到 vite dev server。让手机访问真后端端口也能拿到 HMR 实时前端。
  // 必须在 static / SPA fallback 之前 mount —— 命中即转发，不再走静态。
  // shutdown 路径会调 dispose() 摘 upgrade 监听 + 销毁所有进行中的 socket。
  let devProxy: DevProxyHandle | null = null;
  if (cfg.devProxyPort !== undefined) {
    devProxy = createDevProxy({
      targetPort: cfg.devProxyPort,
      httpServer,
      logger,
    });
    app.use(devProxy.middleware);
  }

  // 0.7.0 v2：worker 不再服务 SPA / 静态资源——所有静态资源由 broker 提供。
  // worker 仅响应反代过来的 /api/health, /api/hook, /ws。访问 worker 根路径
  // 直接 404。

  // 4. WsServer（带认证）—— httpServer 已在 1.10 创建并 listen
  const ws = new WsServer(httpServer, { authenticate: createWsAuthenticate(authModule) });

  // 5. PTY + SessionController
  const pty = new PtyManager();
  const ctrl = new SessionController(pty, ws, cfg.maxBufferLines, {
    writeToProcessStdout: !cfg.noTerminal,
  });
  ctrl.setIntegrationManager(integrations);
  // setPushService 的 url 是 fallback：仅当订阅记录里没存 entryUrl 时用。
  // 0.7.0 起 push-routes subscribe handler 会从 X-ATR-Forwarded-* 头算出每个
  // 订阅自己的 entryUrl 持久化；这里 fallback 用 brokerEntryUrl —— 至少比
  // 0.6.x 时 worker 自己拼的 LAN URL（带 worker port + token）更接近真实入口
  ctrl.setPushService(pushService, {
    instanceName: cfg.instanceName,
    url: brokerEntryUrl,
  });

  // 6. TerminalRelay（条件）
  let relay: TerminalRelay | null = null;
  if (!cfg.noTerminal && process.stdin.isTTY) {
    relay = new TerminalRelay(pty, {
      onExitRequest: () => {
        process.stderr.write('\n[atr] double Ctrl+C detected; shutting down\n');
        shutdown(0);
      },
    });
  }

  // 7. 优雅关闭
  let shuttingDown = false;
  const shutdown = (exitCode = 0): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ exitCode }, '开始优雅关闭');
    // 顺序很关键：
    //  1. 先 stop relay 与 destroy PTY，让 PTY 子进程完全死透
    //     （否则它最后一刻可能再发输出重新打开鼠标跟踪等模式）
    //  2. 再 reset 终端状态（多重防御 + tput reset 兜底）
    //  3. 最后清网络资源
    if (relay) relay.stop();
    pty.destroy();
    if (process.stdout.isTTY) {
      // 关 alt screen + 关鼠标跟踪 + 显示光标 + DECSTR 软重置
      //
      // 注意：以前这里还会发 RIS (\x1bc) hard reset 兜底，但 Windows Terminal /
      // PowerShell conhost 收到 RIS 后会**清屏并把 cursor 复位但不释放 console
      // input mode**，表现为"实例关闭后 PowerShell 终端空屏卡住、按键无响应"。
      // relay.stop() 内部已写过 TERM_RESET_SEQ（含 alt screen / 鼠标 / 光标），
      // 这里只补一些 relay 没覆盖的（焦点事件 1004、SGR 0、DECSTR），不再发 RIS。
      process.stdout.write(
        '\x1b[?1004l' + // 焦点事件
          '\x1b[?25h' + // 显示光标（再次确保）
          '\x1b[!p' + // 软重置
          '\x1b[0m', // 颜色 / 样式重置
      );
      // POSIX 才有 stty；Windows 上 execSync('stty') 会抛错被 catch 吞掉，
      // 但启动一个失败的子进程仍是浪费。所以判 platform 再调
      if (process.platform !== 'win32') {
        try {
          execSync('stty sane 2>/dev/null', { stdio: 'ignore' });
        } catch {
          // 没有 stty 也不要紧，前面的 ANSI 已经做了大部分工作
        }
      }
    }
    // ipMonitor.stop() 不再需要：IpMonitor 已在阶段 2D 移除
    // instances.json watcher 在 broker 端，worker 不需要 stop
    ctrl.destroy();
    integrations.shutdown();
    ws.destroy();
    authModule.destroy();
    devProxy?.dispose();
    // 注销实例（best-effort，不阻塞关闭）
    void registry.unregister(instanceId).catch((err) => {
      logger.warn({ err }, '关闭时注销实例失败');
    });
    httpServer.close(() => {
      logger.info('HTTP server 已关闭');
      process.exit(exitCode);
    });
    setTimeout(() => process.exit(exitCode), SHUTDOWN_FORCE_EXIT_MS).unref();
  };

  pty.on('exit', (exitCode: number) => {
    setTimeout(() => shutdown(exitCode), SHUTDOWN_WS_FLUSH_DELAY_MS);
  });
  // PTY spawn / 运行错误：保留 backend 在线，让 SessionController 的 'error' listener
  // 把消息广播给前端（前端在终端区显示错误文本，并通过 status_update 切回 idle）。
  // 不再 shutdown(1)：用户在浏览器上能看到具体失败原因（如 "posix_spawnp failed"），
  // 而不是 backend 静悄悄退出留下莫名空白。
  //
  // 关键：必须 stop relay —— 否则 stdin 仍处于 raw mode + 监听中，但 PTY 已死，
  // 用户敲键盘无人接 = 本地 PC 终端卡死。stop 后 stdin 还原，用户至少能用 Ctrl+C
  // 退掉 backend，看屏幕看清错误信息后决定下一步。
  pty.on('error', (err: Error) => {
    logger.error({ err }, 'PTY 错误');
    if (relay) relay.stop();
    ctrl.setStatus('idle', err.message);
  });

  // 0.7.0 v2：worker 端不再有 /api/instances/self/shutdown，跨实例 stop 由
  // broker 直接 SIGTERM，下面的 SIGTERM/SIGINT handler 接走 graceful shutdown
  process.on('SIGINT', () => shutdown(0));
  process.on('SIGTERM', () => shutdown(0));

  // listen 已在 1.11 完成；这里只挂运行期错误处理（非 EADDRINUSE，物理上不再可能）
  httpServer.on('error', (err: NodeJS.ErrnoException) => {
    logger.error({ err }, 'HTTP server 运行期错误');
    process.exit(1);
  });

  // 8. banner（PTY 暂不 spawn，等用户按 Enter 后再启动，
  //    避免 Claude 等全屏 TUI 立刻把屏幕清掉、用户根本看不全二维码）
  void (async (): Promise<void> => {
    await renderBannerAndStart();
  })();

  async function renderBannerAndStart(): Promise<void> {
    const tokenPreview =
      cfg.token.length >= 16
        ? `${cfg.token.slice(0, 8)}...${cfg.token.slice(-8)}`
        : cfg.token;

    // Box drawing — inner content width is fixed at BOX_INNER (50 chars).
    // Each render uses helper functions so column alignment is uniform.
    const BOX_INNER = 50;
    const top = `╔${'═'.repeat(BOX_INNER)}╗`;
    const sep = `╠${'═'.repeat(BOX_INNER)}╣`;
    const bot = `╚${'═'.repeat(BOX_INNER)}╝`;
    const row = (text: string): string => {
      // Truncate if too wide; pad if too short.
      const trimmed =
        text.length <= BOX_INNER ? text.padEnd(BOX_INNER) : text.slice(0, BOX_INNER);
      return `║${trimmed}║`;
    };
    const center = (text: string): string => {
      const trimmed = text.length <= BOX_INNER ? text : text.slice(0, BOX_INNER);
      const pad = BOX_INNER - trimmed.length;
      const left = Math.floor(pad / 2);
      const right = pad - left;
      return `║${' '.repeat(left)}${trimmed}${' '.repeat(right)}║`;
    };

    process.stderr.write('\n');
    process.stderr.write(top + '\n');
    process.stderr.write(center('Auvezy Terminal Remote · started') + '\n');
    process.stderr.write(sep + '\n');
    process.stderr.write(row(`  instance: ${cfg.instanceName}`) + '\n');
    process.stderr.write(
      row(`  service:  http://${brokerState.host}:${brokerState.port}`) + '\n',
    );
    process.stderr.write(row(`  token:    ${tokenPreview}`) + '\n');
    process.stderr.write(row(`  source:   ${cfg.tokenSource}`) + '\n');

    // Show the full token only on first generation, so the user can save it once.
    if (cfg.tokenSource === 'generated') {
      process.stderr.write(sep + '\n');
      process.stderr.write(row('  Full token (shown once — save it now):') + '\n');
      process.stderr.write(row(`  ${cfg.token.slice(0, 48)}`) + '\n');
      process.stderr.write(row(`  ${cfg.token.slice(48)}`) + '\n');
    }

    process.stderr.write(bot + '\n');

    // 0.7.0：从 networkInterfaces 推算所有可达 broker 入口（Tailscale / LAN /
    // IPv6 / loopback），按推荐度排序后让用户在 TTY 下选一个看二维码；非 TTY
    // 直接用默认项。详见 broker/entry-discovery.ts、entry-prompt.ts
    const { discoverEntries } = await import('./broker/entry-discovery.js');
    const { promptEntrySelection } = await import('./broker/entry-prompt.js');
    const candidates = discoverEntries({
      brokerPort: brokerState.port,
      instanceId,
      ...(displayIp ? { preferredHost: displayIp } : {}),
      // 0.7.0：URL 带 ?token= 让用户扫码 / 链接粘贴即登录；前端 useAuth 拿到
      // 后自动 fetch /api/auth 换 cookie 并从 URL 删除（与 0.6.x 同行为）
      token: cfg.token,
    });

    const promptResult = await promptEntrySelection({ candidates });
    const chosen = promptResult.selected;

    const qr = await renderQrCode(chosen.url);
    if (qr) {
      process.stderr.write(
        `\n  -- ${chosen.isDefault ? 'recommended' : 'selected'} entry (${chosen.host}) --\n`,
      );
      process.stderr.write(qr);
      process.stderr.write(`  ${chosen.url}\n`);
    }
    // Other candidates (no QR to avoid clutter)
    const others = candidates.filter((c) => c !== chosen);
    if (others.length > 0) {
      process.stderr.write('\n  Other entries (paste any URL):\n');
      for (const c of others) {
        process.stderr.write(`    ${c.url}\n`);
      }
    }
    process.stderr.write(
      '\n  Double Ctrl+C (within 500ms) detaches; single Ctrl+C passes through to the child\n',
    );
    // 视觉分隔：banner 之后是 PTY 子进程的输出（如果 TerminalRelay 启用）
    // 这条很重要：当 OCR_COMMAND 也是 zsh / bash 时，PTY 子进程的 prompt
    // 长得跟外层一模一样，很容易被误以为"backend 退出回到 shell"。
    if (relay) {
      process.stderr.write('\n');
      process.stderr.write(
        `  --- preparing to spawn PTY child (${cfg.claudeCommand}) ---\n`,
      );
      const isHeadlessHint = cfg.noTerminal || !process.stdin.isTTY;
      const mustWaitEnterHint = cli.waitConfirm === true && !isHeadlessHint;
      if (isHeadlessHint) {
        process.stderr.write('  (headless mode: spawning immediately)\n');
      } else if (mustWaitEnterHint) {
        process.stderr.write('  Press Enter to spawn the PTY child (--wait-confirm)\n');
      } else {
        const timeoutHint =
          cfg.spawnTimeoutSec > 0
            ? ` (${cfg.spawnTimeoutSec}s timeout, or browser connect / Enter triggers)`
            : ' (no timeout; browser connect or Enter triggers)';
        process.stderr.write(`  Spawning after browser login${timeoutHint}\n`);
      }
      process.stderr.write('\n');
    } else {
      process.stderr.write('\n');
    }

    // PTY spawn 时机：三种模式
    //
    //  1. headless / 无 TTY / --no-terminal：立即 spawn（无人值守，banner 也无意义）
    //  2. --wait-confirm + TTY：必须按 Enter（覆盖浏览器/超时触发），保留旧语义
    //  3. 默认 + TTY：race（首个 webapp 连入 / Enter / spawnTimeoutSec）
    //     - banner 保持留屏直到 spawn 真的发生 → 用户能看到二维码
    //     - 浏览器先连入立即 spawn → 解决"按 Enter 之前打开链接看到空白"
    //     - 兜底超时（默认 30s，可配）防止用户离开后永远不 spawn
    //
    // startPty 防重入：任一触发命中即 spawn 一次，其它触发 no-op
    const isHeadless = cfg.noTerminal || !process.stdin.isTTY;
    const mustWaitEnter = cli.waitConfirm === true && !isHeadless;

    let ptyStarted = false;
    const startPty = (reason: 'immediate' | 'webapp' | 'enter' | 'timeout'): void => {
      if (ptyStarted) return;
      ptyStarted = true;
      logger.info({ reason }, 'PTY spawn 触发');
      try {
        pty.spawn({
          command: cfg.claudeCommand,
          args: finalClaudeArgs,
          cwd: cfg.claudeCwd,
          ...(ptyExtraEnv ? { env: ptyExtraEnv } : {}),
        });
        if (relay) relay.start();
        ctrl.setStatus('running');
      } catch (err) {
        // PtyManager.spawn 一般通过 'error' 事件而非同步抛错暴露失败；
        // 这里捕获是给"重复 spawn"等同步 PtyError 兜底——同样不退 backend，
        // 让用户能在浏览器上看到状态与日志
        logger.error({ err }, 'spawn PTY 失败');
        ctrl.setStatus('idle', err instanceof Error ? err.message : String(err));
      }
    };

    if (isHeadless) {
      startPty('immediate');
    } else if (mustWaitEnter) {
      const wait = waitForUserConfirm();
      void wait.promise
        .then((r) => {
          if (r.done === 'enter') startPty('enter');
        })
        .catch((err) => {
          logger.error({ err }, '等待 Enter 失败');
          shutdown(1);
        });
    } else {
      // 默认 race：webapp / Enter / 超时 —— 任一触发就 spawn，
      // 同时 cancel 还在挂着的 stdin listener，否则后续 TerminalRelay 收不到本地按键
      const wait = waitForUserConfirm({ silent: true });
      const triggerSpawn = (reason: 'webapp' | 'enter' | 'timeout'): void => {
        wait.cancel();
        startPty(reason);
      };

      // 1) webapp 连入 → spawn（attach 类型不算，attach 是命令行接管，不是浏览器）
      ws.onConnect((_ws, type) => {
        if (type === 'webapp') triggerSpawn('webapp');
      });

      // 2) Enter 键 → spawn
      void wait.promise.then((r) => {
        if (r.done === 'enter') triggerSpawn('enter');
      });

      // 3) 超时兜底（cfg.spawnTimeoutSec=0 时禁用）
      if (cfg.spawnTimeoutSec > 0) {
        setTimeout(() => triggerSpawn('timeout'), cfg.spawnTimeoutSec * 1000).unref();
      }
    }

    // 注册到 instances.json（headless 派生的子进程也走这一步）
    //
    // 字段语义:
    //  - host = worker 监听地址(永远 127.0.0.1,broker 反代连 worker 用)
    //  - brokerHost = 注册该实例的 broker 对外可达 host,前端按这个分组"哪台机";
    //    broker listen 0.0.0.0 时 displayIp 是首选 LAN IP;监听具体 IP 时就是它
    const brokerHost =
      brokerState.host === '0.0.0.0' || brokerState.host === '::'
        ? displayIp
        : brokerState.host;
    void registry
      .register({
        instanceId,
        name: cfg.instanceName,
        host: '127.0.0.1',
        port: cfg.port,
        pid: process.pid,
        cwd: cfg.claudeCwd,
        startedAt: new Date().toISOString(),
        headless: cfg.noTerminal,
        ...(brokerHost ? { brokerHost } : {}),
      })
      .catch((err) => logger.warn({ err }, '注册实例失败'));

    // IP 监控已在阶段 2D 移除（worker 只听 loopback；ip_changed 广播由 broker 端
    // 在阶段 3 重新设计——可能改成 ws 推一个"broker 反代 host 列表更新"事件）

    logger.info(
      {
        port: cfg.port,
        host: cfg.host,
        displayIp,
        instanceId,
        instanceName: cfg.instanceName,
        tokenSource: cfg.tokenSource,
      },
      '服务已启动',
    );
  }
}

/**
 * 等用户按 Enter 才继续。Headless / 非 TTY 模式立即 resolve。
 *
 * 用途：让 banner + 二维码留在屏幕上够久，给用户扫码 / 登录的窗口；
 * 然后才 spawn 全屏 TUI（如 claude）覆盖屏幕。
 *
 * 实现：读 stdin 一行；若 stdin 不是 TTY（pipe 进来 / 守护进程模式）
 * 不阻塞，立即返回。
 */
/**
 * 收集本机所有网卡 IPv4 + IPv6 地址 + localhost / 127.0.0.1。
 * 返回 Set 便于 O(1) 命中判断。
 *
 * 用途：CORS 白名单。把所有"对端能用来访问本机的合法 hostname"都放进来：
 * 物理网卡 LAN IP、Tailscale 100.x.y.z、各种 VPN 网卡、loopback。
 *
 * 不主动加入域名：browser 里 origin 字段只会用 hostname 字面量，所以这里
 * 列 IP 列表足以覆盖；用户如果用域名（如 mywsl.local）需要手动加 OCR_CORS_ALLOW。
 */
function collectLocalHostnames(): Set<string> {
  const set = new Set<string>(['localhost', '127.0.0.1', '::1']);
  const ifaces = networkInterfaces();
  for (const list of Object.values(ifaces)) {
    if (!list) continue;
    for (const info of list) {
      if (info.internal) continue;
      set.add(info.address);
    }
  }
  // 用户额外白名单：OCR_CORS_ALLOW="example.local,foo.bar" 逗号分隔
  const extra = process.env['OCR_CORS_ALLOW'];
  if (extra) {
    for (const h of extra.split(',').map((s) => s.trim()).filter(Boolean)) {
      set.add(h);
    }
  }
  return set;
}

/**
 * 等用户在 stdin 按任意键 / Enter；非 TTY 立即 resolve。
 *
 * @param opts.silent 不打印"按 Enter 启动"提示行（默认模式下 banner 已含等待提示）
 */
/** waitForUserConfirm 的句柄，让外部能在别的触发源（如 webapp）抢先时主动取消等待 */
interface WaitConfirmHandle {
  /** Promise；resolve = 用户按键 / cancel 任一发生（用 done 字段区分） */
  promise: Promise<{ done: 'enter' | 'cancelled' }>;
  /**
   * 主动取消：移除 stdin listener，但**不**调 pause()
   *  - 让 TerminalRelay 后续可以正常 resume + on('data')
   *  - 如果调了 pause，后续 relay.start() 内的 process.stdin.resume()
   *    虽会重开，但若 race 路径里 webapp 先到 → 我们 cancel → resume() ✓ → 实际相同
   *    然而**多余的 pause**容易掩盖问题，干脆别 pause
   */
  cancel: () => void;
}

function waitForUserConfirm(opts: { silent?: boolean } = {}): WaitConfirmHandle {
  if (!process.stdin.isTTY) {
    return {
      promise: Promise.resolve({ done: 'enter' as const }),
      cancel: () => { /* no-op */ },
    };
  }
  if (!opts.silent) {
    process.stderr.write('  Press Enter to spawn the child (or Ctrl+C to exit)...');
  }
  let cancelled = false;
  let onData: ((chunk: Buffer) => void) | null = null;
  let resolveFn: ((v: { done: 'enter' | 'cancelled' }) => void) | null = null;

  const detach = (): void => {
    if (onData) {
      process.stdin.removeListener('data', onData);
      onData = null;
    }
  };

  const promise = new Promise<{ done: 'enter' | 'cancelled' }>((resolve) => {
    resolveFn = resolve;
    onData = (chunk: Buffer): void => {
      if (cancelled) return;
      if (chunk.length === 0) return;
      detach();
      if (!opts.silent) process.stderr.write('\r\x1b[K');
      resolve({ done: 'enter' });
    };
    process.stdin.resume();
    process.stdin.on('data', onData);
  });

  return {
    promise,
    cancel: () => {
      if (cancelled) return;
      cancelled = true;
      detach();
      if (!opts.silent) process.stderr.write('\r\x1b[K');
      resolveFn?.({ done: 'cancelled' });
    },
  };
}
