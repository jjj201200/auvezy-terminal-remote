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
import { createInstanceRoutes } from './instance-routes.js';
import { createPushRoutes } from './push-routes.js';
import { createShareRoutes } from './share-routes.js';
import {
  createWorkdirPolicyRoutes,
  type WorkdirPolicySnapshot,
} from './workdir-policy-routes.js';
import type { AuthModule } from '../auth/auth-middleware.js';
import type { HookReceiver } from '../hooks/hook-receiver.js';
import type { InstanceRegistryManager } from '../registry/instance-registry.js';
import type { InstanceSpawner } from '../registry/instance-spawner.js';
import type { PushService } from '../push/push-service.js';

export interface ApiRouterOptions {
  /** 认证模块；不传则不挂 /auth 路由 */
  authModule?: AuthModule;
  /** Hook 接收器；不传则不挂 /hook 路由（仅 localhost 可访问） */
  hookReceiver?: HookReceiver;
  /** 配置存储；与 authModule 同时存在时挂 /config 路由 */
  configStore?: ConfigStore;
  /** 实例注册表；与 authModule + currentInstanceId 同时存在时挂 /instances */
  registry?: InstanceRegistryManager;
  /** 当前进程 instanceId（用于 isCurrent 标记） */
  currentInstanceId?: string;
  /** 派生新实例（可选，不传则 POST /instances 返回 501） */
  spawner?: InstanceSpawner;
  /** Web Push 服务；与 authModule 同时存在时挂 /push 路由 */
  pushService?: PushService;
  /** 当前实例端口；与 authModule 同时存在时挂 /share/endpoints */
  port?: number;
  /** 当前实例 displayIp；用于 /share 标记默认入口 */
  displayIp?: string;
  /** 触发本进程优雅关闭（暴露 POST /instances/self/shutdown，跨实例 stop 用） */
  selfShutdown?: () => void;
  /** 共享 token：跨实例 HTTP 调 self-shutdown 用；无则跳过 HTTP 路径 */
  sharedToken?: string;
  /** workdir 策略快照器；与 authModule 同时存在时挂 /workdir-policy */
  workdirPolicy?: () => WorkdirPolicySnapshot;
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

  // 实例列表 + 派生（需鉴权）
  if (opts.authModule && opts.registry && opts.currentInstanceId) {
    router.use(
      createInstanceRoutes({
        authModule: opts.authModule,
        registry: opts.registry,
        currentInstanceId: opts.currentInstanceId,
        spawner: opts.spawner,
        selfShutdown: opts.selfShutdown,
        sharedToken: opts.sharedToken,
      }),
    );
  }

  // Web Push（GET /vapid 公开；订阅 CRUD 鉴权）
  if (opts.authModule && opts.pushService) {
    router.use(createPushRoutes(opts.authModule, opts.pushService));
  }

  // 分享入口列表（鉴权）
  if (opts.authModule && typeof opts.port === 'number' && opts.displayIp) {
    router.use(
      createShareRoutes({
        authModule: opts.authModule,
        port: opts.port,
        displayIp: opts.displayIp,
      }),
    );
  }

  // workdir 策略只读快照（鉴权）—— 给前端 cwd base 选择器用
  if (opts.authModule && opts.workdirPolicy) {
    router.use(createWorkdirPolicyRoutes(opts.authModule, opts.workdirPolicy));
  }

  return router;
}
