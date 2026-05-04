/**
 * Backend 服务入口（阶段 1）
 *
 * 启动流程（22 阶段中本阶段实现的部分）：
 *  1. 读环境变量决定端口/命令/工作目录
 *  2. Express + JSON + 健康检查 + 静态文件 + SPA fallback
 *  3. 创建 HttpServer（用于 WS upgrade 共用）
 *  4. 创建 PtyManager + WsServer + SessionController
 *  5. 条件创建 TerminalRelay（NO_TERMINAL 或非 TTY 时跳过）
 *  6. spawn Claude 进程
 *  7. SIGINT/SIGTERM/EADDRINUSE/PTY exit/双 Ctrl+C → 优雅 shutdown
 *  8. listen 后打印 banner
 *
 * 阶段 1 不做的事：
 *  - 认证（阶段 2）
 *  - 配置文件（阶段 4）
 *  - 共享 Token（阶段 5）
 *  - 多实例（阶段 6）
 *  - hooks 接收 / 审批通知（阶段 3）
 *  - IP 监控 / Push（阶段 8/9）
 */

import { createServer, type Server as HttpServer } from 'node:http';
import { existsSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { DEFAULT_PORT, DEFAULT_MAX_BUFFER_LINES } from '@ocr/shared';
import { logger } from './logger/logger.js';
import { createApiRouter } from './api/router.js';
import { PtyManager } from './pty/pty-manager.js';
import { WsServer } from './ws/ws-server.js';
import { SessionController } from './session/session-controller.js';
import { TerminalRelay } from './terminal/terminal-relay.js';
import {
  SHUTDOWN_WS_FLUSH_DELAY_MS,
  SHUTDOWN_FORCE_EXIT_MS,
} from './constants.js';

/** 启动覆盖（阶段 1：仅 port；后续阶段会扩展整套 CliOverrides） */
export interface StartServerOverrides {
  port?: number;
}

export async function startServer(overrides: StartServerOverrides = {}): Promise<void> {
  // 1. 解析配置（阶段 1 仅环境变量）
  const port = overrides.port ?? (Number(process.env['PORT']) || DEFAULT_PORT);
  const host = process.env['HOST'] ?? '0.0.0.0';
  const claudeCommand = process.env['CLAUDE_COMMAND'] ?? 'claude';
  const claudeCwd = process.env['CLAUDE_CWD'] ?? process.cwd();
  const claudeArgs = process.env['CLAUDE_ARGS']
    ? (() => {
        try {
          const parsed = JSON.parse(process.env['CLAUDE_ARGS']!);
          return Array.isArray(parsed) ? (parsed as string[]) : [];
        } catch {
          return [];
        }
      })()
    : [];
  const maxBufferLines = Number(process.env['MAX_BUFFER_LINES']) || DEFAULT_MAX_BUFFER_LINES;
  const noTerminal = process.env['NO_TERMINAL'] === 'true';
  const instanceName = process.env['INSTANCE_NAME'] ?? basename(claudeCwd);

  logger.info(
    { port, host, claudeCommand, claudeCwd, claudeArgs, maxBufferLines, noTerminal, instanceName },
    '加载阶段 1 配置',
  );

  // 2. Express + 路由
  const app = express();
  app.use(express.json());
  app.use('/api', createApiRouter());

  // 3. 静态前端
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

  // 4. HTTP server（WS 复用）
  const httpServer: HttpServer = createServer(app);

  // 5. PTY + WsServer + SessionController
  const pty = new PtyManager();
  const ws = new WsServer(httpServer);
  const ctrl = new SessionController(pty, ws, maxBufferLines, {
    writeToProcessStdout: !noTerminal,
  });

  // 6. TerminalRelay（条件启动）
  // 双 Ctrl+C 退代理 → shutdown
  let relay: TerminalRelay | null = null;
  if (!noTerminal && process.stdin.isTTY) {
    relay = new TerminalRelay(pty, {
      onExitRequest: () => {
        process.stderr.write('\n[claude-remote] 检测到双 Ctrl+C，正在退出代理…\n');
        shutdown(0);
      },
    });
  }

  // 7. 优雅 shutdown
  let shuttingDown = false;
  const shutdown = (exitCode = 0): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ exitCode }, '开始优雅关闭');
    if (relay) relay.stop();
    ctrl.destroy();
    pty.destroy();
    ws.destroy();
    httpServer.close(() => {
      logger.info('HTTP server 已关闭');
      process.exit(exitCode);
    });
    setTimeout(() => process.exit(exitCode), SHUTDOWN_FORCE_EXIT_MS).unref();
  };

  // PTY exit → 留点时间 flush 后关闭
  pty.on('exit', (exitCode: number) => {
    setTimeout(() => shutdown(exitCode), SHUTDOWN_WS_FLUSH_DELAY_MS);
  });
  pty.on('error', (err: Error) => {
    logger.error({ err }, 'PTY 启动错误，退出');
    setTimeout(() => shutdown(1), SHUTDOWN_WS_FLUSH_DELAY_MS);
  });

  process.on('SIGINT', () => shutdown(0));
  process.on('SIGTERM', () => shutdown(0));

  // 端口冲突兜底（虽然阶段 1 没有 port-finder，但 EADDRINUSE 仍要处理）
  httpServer.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      logger.error({ port, host }, '端口已被占用');
      process.exit(1);
    }
    logger.error({ err }, 'HTTP server 错误');
    process.exit(1);
  });

  // 8. spawn Claude（PTY 起来后才设置 status=running）
  pty.spawn({
    command: claudeCommand,
    args: claudeArgs,
    cwd: claudeCwd,
  });
  if (relay) relay.start();
  ctrl.setStatus('running');

  // 9. 监听
  httpServer.listen(port, host, () => {
    process.stderr.write('\n');
    process.stderr.write('╔══════════════════════════════════════════════════╗\n');
    process.stderr.write('║         Open-Claude-Remote · 阶段 1 启动         ║\n');
    process.stderr.write('╠══════════════════════════════════════════════════╣\n');
    process.stderr.write(`║  实例:    ${instanceName.padEnd(38)}║\n`);
    process.stderr.write(`║  地址:    http://${host}:${port}`.padEnd(53) + '║\n');
    process.stderr.write(`║  命令:    ${claudeCommand} ${claudeArgs.join(' ')}`.padEnd(53) + '║\n');
    process.stderr.write(`║  工作目录: ${claudeCwd.padEnd(37)}║\n`);
    process.stderr.write('╚══════════════════════════════════════════════════╝\n');
    process.stderr.write('  双 Ctrl+C（500ms 内）退出代理；单次 Ctrl+C 透传给 Claude\n');
    process.stderr.write('\n');
    logger.info({ port, host, instanceName }, '服务已启动');
  });
}
