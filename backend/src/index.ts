/**
 * Backend 服务入口
 *
 * 导出 startServer() 供 cli.ts 调用。
 *
 * 阶段 0 实现内容：
 * - 创建 Express + JSON 中间件
 * - 挂 /api 路由（仅 health）
 * - 监听端口（默认 3000）
 * - SIGINT/SIGTERM 优雅关闭
 *
 * 后续阶段会扩展启动序列（最终 22 步），详见设计文档第 5.3 节。
 */

import { createServer, type Server as HttpServer } from 'node:http';
import express from 'express';
import { DEFAULT_PORT } from '@ocr/shared';
import { logger } from './logger/logger.js';
import { createApiRouter } from './api/router.js';

/**
 * 启动服务
 *
 * @param overrides 覆盖默认配置（阶段 0 仅支持 port，后续扩展）
 */
export async function startServer(overrides: { port?: number } = {}): Promise<void> {
  const port = overrides.port ?? DEFAULT_PORT;
  const host = '0.0.0.0';

  // 1. Express 应用
  const app = express();
  app.use(express.json());

  // 2. /api 路由
  app.use('/api', createApiRouter());

  // 3. HTTP server
  const httpServer: HttpServer = createServer(app);

  // 4. 错误处理
  httpServer.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      logger.error({ port, host }, '端口已被占用');
      process.exit(1);
    }
    logger.error({ err }, 'HTTP server 错误');
    process.exit(1);
  });

  // 5. 优雅关闭
  let shuttingDown = false;
  const shutdown = (exitCode = 0): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ exitCode }, '收到关闭信号，开始优雅关闭');
    httpServer.close(() => {
      logger.info('HTTP server 已关闭');
      process.exit(exitCode);
    });
    // 兜底：2s 后强制退出
    setTimeout(() => process.exit(exitCode), 2000).unref();
  };

  process.on('SIGINT', () => shutdown(0));
  process.on('SIGTERM', () => shutdown(0));

  // 6. 启动监听
  httpServer.listen(port, host, () => {
    logger.info({ port, host }, '服务已启动（阶段 0 骨架）');
    process.stderr.write(`\n  Open-Claude-Remote 后端就绪（阶段 0）\n`);
    process.stderr.write(`  健康检查: http://localhost:${port}/api/health\n\n`);
  });
}
