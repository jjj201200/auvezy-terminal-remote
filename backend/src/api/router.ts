/**
 * API 路由聚合器
 *
 * 把各个领域路由（health / auth / config / hook / instance / push / status）
 * 挂到统一的 /api 前缀下。
 *
 * 阶段 0：仅挂 health 路由。后续阶段按需扩展。
 *
 * 设计：用工厂函数 + options 对象注入依赖，便于：
 * - 单测（直接 new Router 不需要起整个 server）
 * - 多实例（同一进程内可以挂多套路由，未来扩展）
 */

import { Router } from 'express';
import { createHealthRoutes } from './health-routes.js';

export interface ApiRouterOptions {
  // 阶段 0 占位，后续阶段会注入：
  // authModule?: AuthModule
  // hookReceiver?: HookReceiver
  // pushService?: PushService
  // getController?: () => SessionController | null
  // ...
}

/**
 * 创建 /api 路由聚合
 *
 * @param _opts 注入依赖（阶段 0 暂未使用）
 */
export function createApiRouter(_opts: ApiRouterOptions = {}): Router {
  const router = Router();

  // 健康检查（公开）
  router.use(createHealthRoutes());

  return router;
}
