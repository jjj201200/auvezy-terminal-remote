/**
 * Backend 服务入口（阶段 6a）
 *
 * 启动流程：
 *  1. loadConfig（CLI > env > config.json > 默认）→ AppConfig
 *  1.4 共享 Token：cli/env 都没指定时，走 acquireSharedToken（withFileLock）
 *  1.5 解析用户 --settings + 合并 claude-remote hooks → 写 settings 文件
 *  1.6 detectDisplayIp 选 LAN IP，构造扫码 URL
 *  1.7 多实例：findAvailablePort（preferred 起递增）+ 生成 instanceId
 *  2. 创建 AuthModule（cookie 名按"实际端口"绑）+ HookReceiver
 *  3. Express + CORS（含 displayIp）+ /api 路由（含 /auth + /config + /hook + /instances）
 *  4. 静态前端 + SPA fallback
 *  5. HttpServer + WsServer
 *  6. PtyManager + SessionController + 条件 TerminalRelay
 *  7. spawn → setStatus(running)
 *  7.5 注册到 instances.json
 *  8. SIGINT/SIGTERM/双 Ctrl+C/PTY exit/EADDRINUSE → shutdown（同步注销实例）
 *  9. listen 后打印 banner（扫码 URL + ASCII QR）
 *
 * 阶段 6a 不做：IP 监控 / Push
 */

import { createServer, type Server as HttpServer } from 'node:http';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import type { UserConfig } from '@ocr/shared';
import { logger } from './logger/logger.js';
import { createApiRouter } from './api/router.js';
import type { ConfigStore } from './api/config-routes.js';
import { PtyManager } from './pty/pty-manager.js';
import { WsServer } from './ws/ws-server.js';
import { SessionController } from './session/session-controller.js';
import { TerminalRelay } from './terminal/terminal-relay.js';
import {
  AuthModule,
  createSessionCookieName,
} from './auth/auth-middleware.js';
import { generateToken } from './auth/token-generator.js';
import { createWsAuthenticate } from './auth/ws-authenticate.js';
import { HookReceiver } from './hooks/hook-receiver.js';
import {
  createClaudeSettings,
  saveClaudeSettings,
  extractSettingsFromArgs,
  loadConfig,
  saveUserConfig,
  type AppConfig,
} from './config.js';
import type { ParsedCliArgs } from './cli-utils.js';
import { acquireSharedToken } from './registry/shared-token.js';
import { findAvailablePort } from './registry/port-finder.js';
import { InstanceRegistryManager } from './registry/instance-registry.js';
import { DefaultInstanceSpawner } from './registry/instance-spawner.js';
import { detectDisplayIp, buildPublicUrl } from './utils/network.js';
import { renderQrCode } from './utils/qrcode-banner.js';
import { IpMonitor } from './utils/ip-monitor.js';
import { PushService } from './push/push-service.js';
import { randomUUID } from 'node:crypto';
import {
  SHUTDOWN_WS_FLUSH_DELAY_MS,
  SHUTDOWN_FORCE_EXIT_MS,
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
  const cli: ParsedCliArgs = overrides.cli ?? { subcommand: 'start', claudeArgs: [] };
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

  // 1.6 displayIp（先选好让后续 banner / CORS 用）
  const displayIp = detectDisplayIp(cfg.host);

  // 1.7 端口自动递增（preferred 被占 → +1）+ 生成 instanceId
  //    探测时仅在 127.0.0.1 上做（与实际监听 host 无关；只判端口空闲）
  const actualPort = await findAvailablePort({
    preferred: cfg.port,
    host: '127.0.0.1',
  });
  if (actualPort !== cfg.port) {
    cfg.port = actualPort;
  }
  const instanceId = randomUUID();
  const publicUrl = buildPublicUrl(displayIp, cfg.port, cfg.token);

  // 1.8 IP 监控（Wi-Fi 切换 → 广播 ip_changed）
  const ipMonitor = new IpMonitor({ initialIp: displayIp, hostHint: cfg.host });

  // 1.9 PushService（VAPID + 订阅；hook 触发时推送给已订阅手机）
  const pushService = new PushService();
  await pushService.init();

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
    },
    '加载阶段 5 配置',
  );

  // 1.5 Hook 配置 + Claude settings 文件
  //   - 解析用户原始 --settings 参数（如有）
  //   - 与 claude-remote 的 hooks 合并
  //   - 写入 ~/.claude-remote/settings/<port>.json
  //   - 把 --settings <path> 追加到 claudeArgs
  const extracted = extractSettingsFromArgs(cfg.claudeArgs);
  const finalClaudeArgs = extracted ? extracted.remainingArgs : [...cfg.claudeArgs];
  const settings = createClaudeSettings(cfg.port, extracted?.value);
  const settingsPath = saveClaudeSettings(settings, cfg.port);
  finalClaudeArgs.push('--settings', settingsPath);

  // 2. AuthModule
  const cookieName = createSessionCookieName(cfg.port);
  const authModule = new AuthModule({
    token: cfg.token,
    sessionTtlMs: cfg.sessionTtlMs,
    rateLimitPerMinute: cfg.authRateLimit,
    cookieName,
  });

  // 2.5 HookReceiver（业务逻辑解耦：路由层只接收，控制器监听 'notification' 事件）
  const hookReceiver = new HookReceiver();

  // 2.6 ConfigStore：把内存中的 userConfig 与 config.json 写盘连接起来
  //   - get() 返回当前内存值
  //   - set() 写盘 + 更新内存（让 GET /api/config 立即反映新值）
  let currentUserConfig: UserConfig = cfg.userConfig;
  const configStore: ConfigStore = {
    get: () => currentUserConfig,
    set: (value) => {
      saveUserConfig(value, cfg.userConfigPath);
      currentUserConfig = value;
    },
  };

  // 2.7 注册表 + Spawner（用于 /api/instances）
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const registry = new InstanceRegistryManager();
  const spawner = new DefaultInstanceSpawner({
    cliJsPath: resolve(__dirname, 'cli.js'),
  });

  // 3. Express
  const app = express();
  app.use(express.json());

  // CORS：同源 + localhost/127.0.0.1 + 检测到的 displayIp（任意端口）
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
          if (
            url.hostname === 'localhost' ||
            url.hostname === '127.0.0.1' ||
            url.hostname === displayIp
          ) {
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

  // /api 路由（含 /auth + /config + /hook + /instances + /push）
  app.use(
    '/api',
    createApiRouter({
      authModule,
      hookReceiver,
      configStore,
      registry,
      currentInstanceId: instanceId,
      spawner,
      pushService,
    }),
  );

  // 静态前端 + SPA fallback
  const frontendDist = resolve(__dirname, '..', 'frontend-dist');
  if (existsSync(frontendDist)) {
    app.use(express.static(frontendDist));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api') || req.path.startsWith('/ws')) {
        return next();
      }
      res.sendFile(resolve(frontendDist, 'index.html'));
    });
    logger.info({ path: frontendDist }, '前端静态文件已挂载');
  } else {
    logger.warn({ expected: frontendDist }, '前端 dist 不存在，跳过静态服务');
  }

  // 4. HTTP server + WsServer（带认证）
  const httpServer: HttpServer = createServer(app);
  const ws = new WsServer(httpServer, { authenticate: createWsAuthenticate(authModule) });

  // 5. PTY + SessionController
  const pty = new PtyManager();
  const ctrl = new SessionController(pty, ws, cfg.maxBufferLines, {
    writeToProcessStdout: !cfg.noTerminal,
  });
  ctrl.setHookReceiver(hookReceiver);
  ctrl.setPushService(pushService, {
    instanceName: cfg.instanceName,
    url: publicUrl,
  });

  // 6. TerminalRelay（条件）
  let relay: TerminalRelay | null = null;
  if (!cfg.noTerminal && process.stdin.isTTY) {
    relay = new TerminalRelay(pty, {
      onExitRequest: () => {
        process.stderr.write('\n[claude-remote] 检测到双 Ctrl+C，正在退出代理…\n');
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
    if (relay) relay.stop();
    ipMonitor.stop();
    ctrl.destroy();
    pty.destroy();
    ws.destroy();
    authModule.destroy();
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
  pty.on('error', (err: Error) => {
    logger.error({ err }, 'PTY 启动错误，退出');
    setTimeout(() => shutdown(1), SHUTDOWN_WS_FLUSH_DELAY_MS);
  });

  process.on('SIGINT', () => shutdown(0));
  process.on('SIGTERM', () => shutdown(0));

  httpServer.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      logger.error({ port: cfg.port, host: cfg.host }, '端口已被占用');
      process.exit(1);
    }
    logger.error({ err }, 'HTTP server 错误');
    process.exit(1);
  });

  // 8. spawn（使用合并 hook settings 后的 args）
  pty.spawn({ command: cfg.claudeCommand, args: finalClaudeArgs, cwd: cfg.claudeCwd });
  if (relay) relay.start();
  ctrl.setStatus('running');

  // 9. listen + banner
  httpServer.listen(cfg.port, cfg.host, () => {
    const tokenPreview =
      cfg.token.length >= 16
        ? `${cfg.token.slice(0, 8)}...${cfg.token.slice(-8)}`
        : cfg.token;

    process.stderr.write('\n');
    process.stderr.write('╔══════════════════════════════════════════════════╗\n');
    process.stderr.write('║         Open-Claude-Remote · 阶段 5 启动         ║\n');
    process.stderr.write('╠══════════════════════════════════════════════════╣\n');
    process.stderr.write(`║  实例:    ${cfg.instanceName.padEnd(38)}║\n`);
    process.stderr.write(`║  监听:    http://${cfg.host}:${cfg.port}`.padEnd(53) + '║\n');
    process.stderr.write(`║  扫码:    http://${displayIp}:${cfg.port}`.padEnd(53) + '║\n');
    process.stderr.write(`║  Token:   ${tokenPreview.padEnd(38)}║\n`);
    process.stderr.write(`║  来源:    ${cfg.tokenSource.padEnd(38)}║\n`);

    // 仅在新生成（generated）token 时把完整 token 印出来一次让用户保存
    if (cfg.tokenSource === 'generated') {
      process.stderr.write('╠══════════════════════════════════════════════════╣\n');
      process.stderr.write('║  完整 Token（首次显示，请保存）:                 ║\n');
      process.stderr.write(`║  ${cfg.token.slice(0, 48).padEnd(48)}║\n`);
      process.stderr.write(`║  ${cfg.token.slice(48).padEnd(48)}║\n`);
    }

    process.stderr.write('╚══════════════════════════════════════════════════╝\n');

    // ASCII QR：手机扫码即登入（已带 ?token=...）
    const qr = renderQrCode(publicUrl);
    if (qr) {
      process.stderr.write('\n  扫码登入：\n');
      process.stderr.write(qr);
    }
    process.stderr.write(`\n  完整链接：${publicUrl}\n`);
    process.stderr.write('  双 Ctrl+C（500ms 内）退出代理；单次 Ctrl+C 透传给 Claude\n');
    process.stderr.write('\n');

    // 注册到 instances.json（headless 派生的子进程也走这一步）
    void registry
      .register({
        instanceId,
        name: cfg.instanceName,
        host: displayIp,
        port: cfg.port,
        pid: process.pid,
        cwd: cfg.claudeCwd,
        startedAt: new Date().toISOString(),
        headless: cfg.noTerminal,
      })
      .catch((err) => logger.warn({ err }, '注册实例失败'));

    // 启动 IP 监控；变化时广播 ip_changed
    ipMonitor.onChange(({ oldIp, newIp }) => {
      const newUrl = buildPublicUrl(newIp, cfg.port, cfg.token);
      ws.broadcast({ type: 'ip_changed', oldIp, newIp, newUrl });
    });
    ipMonitor.start();

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
  });
}
