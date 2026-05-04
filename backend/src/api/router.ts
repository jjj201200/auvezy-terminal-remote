/**
 * API 路由聚合器
 *
 * 把各个领域路由（health / auth / config / hook / instance / push / status）
 * 挂到统一的 /api 前缀下。
 *
 * 阶段 2：挂 health（公开）+ auth（公开）。后续阶段按需扩展。
 *
 * 设计：用工厂函数 + options 对象注入依赖，便于：
 * - 单测（直接 new Router 不需要起整个 server）
 * - 多实例（同一进程内可以挂多套路由，未来扩展）
 */

import { Router } from 'express';
import { createHealthRoutes } from './health-routes.js';
import { createAuthRoutes } from './auth-routes.js';
import { createHookRoutes } from './hook-routes.js';
import { createConfigRoutes, type ConfigStore } from './config-routes.js';
import type { AuthModule } from '../auth/auth-middleware.js';
import type { HookReceiver } from '../hooks/hook-receiver.js';

export interface ApiRouterOptions {
  /** 认证模块；不传则不挂 /auth 路由 */
  authModule?: AuthModule;
  /** Hook 接收器；不传则不挂 /hook 路由（仅 localhost 可访问） */
  hookReceiver?: HookReceiver;
  /** 配置存储；与 authModule 同时存在时挂 /config 路由 */
  configStore?: ConfigStore;
  // 后续阶段会注入：
  // pushService?: PushService
  // getController?: () => SessionController | null
  // ...
}

/**
 * 创建 /api 路由聚合
 */
export function createApiRouter(opts: ApiRouterOptions = {}): Router {
  const router = Router();

  // 健康检查（公开）
  router.use(createHealthRoutes());

  // 认证（公开端点本身，但成功后才能拿到 cookie）
  if (opts.authModule) {
    router.use(createAuthRoutes(opts.authModule));
  }

  // 配置（需鉴权）
  if (opts.authModule && opts.configStore) {
    router.use(createConfigRoutes(opts.authModule, opts.configStore));
  }

  // Hook 接收（路由内部做 loopback 限制，无需鉴权）
  if (opts.hookReceiver) {
    router.use(createHookRoutes(opts.hookReceiver));
  }

  return router;
}
