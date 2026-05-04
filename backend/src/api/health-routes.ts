/**
 * 健康检查路由
 *
 * GET /api/health 用于：
 * - 启动后快速验证服务可达性
 * - 监控/外部探活（如果未来上 PM2、systemd 健康检查）
 * - 不需要认证（公开端点）
 */

import { Router, type Request, type Response } from 'express';

export function createHealthRoutes(): Router {
  const router = Router();

  router.get('/health', (_req: Request, res: Response) => {
    res.json({
      ok: true,
      timestamp: new Date().toISOString(),
      uptime: Math.floor(process.uptime()),
    });
  });

  return router;
}
