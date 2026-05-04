/**
 * /api/auth 路由
 *
 * 仅一个端点：POST /auth → AuthModule.handleAuth
 *
 * 此端点不需要"已认证"前置条件——它本身就是认证入口。
 * 限流由 AuthModule 内部 RateLimiter 实现。
 */

import { Router } from 'express';
import type { AuthModule } from '../auth/auth-middleware.js';

export function createAuthRoutes(authModule: AuthModule): Router {
  const router = Router();
  router.post('/auth', authModule.handleAuth);
  return router;
}
