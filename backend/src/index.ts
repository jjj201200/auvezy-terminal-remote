/**
 * Backend 服务入口（阶段 4）
 *
 * 启动流程：
 *  1. loadConfig（CLI > env > config.json > 默认）→ AppConfig
 *  1.5 解析用户 --settings + 合并 claude-remote hooks → 写 settings 文件
 *  2. 创建 AuthModule（绑定端口的 cookie 名）+ HookReceiver
 *  3. Express + JSON + CORS 白名单 + /api 路由（含 /auth + /config + /hook）
 *  4. 静态前端 + SPA fallback
 *  5. HttpServer + WsServer（authenticate hook 接 AuthModule）
 *  6. PtyManager + SessionController + setHookReceiver + 条件 TerminalRelay
 *  7. spawn（透传 --settings <path>）→ setStatus(running)
 *  8. SIGINT/SIGTERM/双 Ctrl+C/PTY exit/EADDRINUSE → shutdown
 *  9. listen 后打印 banner（首次显示完整 token，后续仅显示 shared 标记）
 *
 * 阶段 4 不做：共享 Token / 多实例 / IP 监控 / Push
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

  logger.info(
    {
      port: cfg.port,
      host: cfg.host,
      claudeCommand: cfg.claudeCommand,
      claudeCwd: cfg.claudeCwd,
      claudeArgs: cfg.claudeArgs,
      instanceName: cfg.instanceName,
      tokenSource: cfg.tokenSource,
      userConfigPath: cfg.userConfigPath,
    },
    '加载阶段 4 配置',
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

  // 3. Express
  const app = express();
  app.use(express.json());

  // CORS：仅允许同源 + 局域网常见地址
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
          // 阶段 2：localhost / 127.0.0.1 + 任意端口
          // 阶段 5 引入 displayIp 后再加 LAN IP 白名单
          if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
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

  // /api 路由（含 /auth + /config + /hook）
  app.use('/api', createApiRouter({ authModule, hookReceiver, configStore }));

  // 静态前端 + SPA fallback
  const __dirname = dirname(fileURLToPath(import.meta.url));
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
    ctrl.destroy();
    pty.destroy();
    ws.destroy();
    authModule.destroy();
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
    process.stderr.write('║         Open-Claude-Remote · 阶段 4 启动         ║\n');
    process.stderr.write('╠══════════════════════════════════════════════════╣\n');
    process.stderr.write(`║  实例:    ${cfg.instanceName.padEnd(38)}║\n`);
    process.stderr.write(`║  地址:    http://${cfg.host}:${cfg.port}`.padEnd(53) + '║\n');
    process.stderr.write(`║  Token:   ${tokenPreview.padEnd(38)}║\n`);

    if (cfg.tokenSource === 'generated') {
      process.stderr.write('╠══════════════════════════════════════════════════╣\n');
      process.stderr.write('║  完整 Token（粘贴到手机）:                       ║\n');
      // 64 字符 token 一行放不下，分两行打印
      process.stderr.write(`║  ${cfg.token.slice(0, 48).padEnd(48)}║\n`);
      process.stderr.write(`║  ${cfg.token.slice(48).padEnd(48)}║\n`);
    }

    process.stderr.write('╚══════════════════════════════════════════════════╝\n');
    process.stderr.write('  双 Ctrl+C（500ms 内）退出代理；单次 Ctrl+C 透传给 Claude\n');
    process.stderr.write('\n');
    logger.info(
      { port: cfg.port, host: cfg.host, instanceName: cfg.instanceName, tokenSource: cfg.tokenSource },
      '服务已启动',
    );
  });
}
