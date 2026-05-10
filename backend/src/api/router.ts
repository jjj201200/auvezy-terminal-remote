/**
 * API 路由聚合器（0.7.0 v2 / API 归属重划分）
 *
 * 拆成两组工厂：
 *  - `createBrokerApiRouter`：broker 进程持有的"系统级"API
 *      auth / config / instances / push / share / workdir / health / SSE
 *  - `createWorkerApiRouter`：worker 进程持有的"实例级"API
 *      health（探活）/ hook（loopback only）
 *
 * 设计原因（见 docs/plans/path-routing/design-v2-api-ownership.md）：
 *  - broker-only 状态（没起任何 worker）下 webapp 必须能登录、列实例、创建实例
 *  - worker 只负责一个 PTY 实例的生命周期（终端 IO + claude hook）
 *
 * 老的 `createApiRouter`（同时混挂全部）已废弃。worker 端 self-shutdown
 * HTTP 中转也一并取消——broker DELETE 直接 process.kill 即可。
 */

import { Router } from 'express';
import { createHealthRoutes } from './health-routes.js';
import { createAuthRoutes } from './auth-routes.js';
import { createHookRoutes } from './hook-routes.js';
import { createConfigRoutes, type ConfigStore } from './config-routes.js';
import { createBrokerInstanceRoutes } from './instance-routes.js';
import { createPushRoutes } from './push-routes.js';
import { createShareRoutes } from './share-routes.js';
import {
  createWorkdirPolicyRoutes,
  type WorkdirPolicySnapshot,
} from './workdir-policy-routes.js';
import type { AuthModule } from '../auth/auth-middleware.js';
import type { IntegrationManager } from '../integrations/manager.js';
import type { InstanceRegistryManager } from '../registry/instance-registry.js';
import type { InstanceSpawner } from '../registry/instance-spawner.js';
import type { PushService } from '../push/push-service.js';

// ──────────────── broker 端 ────────────────

export interface BrokerApiRouterOptions {
  authModule: AuthModule;
  configStore: ConfigStore;
  registry: InstanceRegistryManager;
  spawner: InstanceSpawner;
  pushService: PushService;
  /** 当前实例 / displayIp 已不再相关：broker 是入口，不属于任何 instance */
  brokerPort: number;
  /** broker 监听 host（detectDisplayIp 等过算法的结果），用于 share endpoints */
  displayIp: string;
  workdirPolicy: () => WorkdirPolicySnapshot;
}

/**
 * 创建 broker 进程的 /api 路由
 *
 * 全部路径在"broker 根"下，与某个具体 instanceId 无关。前端 fetch 这些
 * 端点时使用绝对路径 `/api/...`（不走 `/i/<id>/api/...`）。
 */
export function createBrokerApiRouter(opts: BrokerApiRouterOptions): Router {
  const router = Router();

  // 健康检查（公开）—— broker 自己的 health；worker 反代时另有一份 worker /api/health
  router.use(createHealthRoutes());

  // 认证：cookie 由 broker 写，session 落 SessionsStore（共享文件）
  router.use(createAuthRoutes(opts.authModule));

  // 用户配置（鉴权）
  router.use(createConfigRoutes(opts.authModule, opts.configStore));

  // 实例列表 + 派生（鉴权）—— 异步语义：POST 立即返回 202 + instanceId，
  // worker 注册 instances.json 时由 file watcher → SSE 推 ready
  router.use(
    createBrokerInstanceRoutes({
      authModule: opts.authModule,
      registry: opts.registry,
      spawner: opts.spawner,
    }),
  );

  // Web Push（GET /vapid 公开；订阅 CRUD 鉴权）
  router.use(createPushRoutes(opts.authModule, opts.pushService));

  // 分享入口列表（鉴权）—— broker 才知道自己监听 host 集合
  router.use(
    createShareRoutes({
      authModule: opts.authModule,
      port: opts.brokerPort,
      displayIp: opts.displayIp,
    }),
  );

  // workdir 策略只读快照（鉴权）
  router.use(createWorkdirPolicyRoutes(opts.authModule, opts.workdirPolicy));

  return router;
}

// ──────────────── worker 端 ────────────────

export interface WorkerApiRouterOptions {
  /** Integration 管理器（claude hook 翻译） */
  integrations: IntegrationManager;
}

/**
 * 创建 worker 进程的 /api 路由
 *
 * 仅保留两条路径：
 *  - `/api/health`：broker 反代时给 worker 探活用
 *  - `/api/hook`：claude hook 仅 loopback 可达
 *
 * **不**挂 auth / config / instances / push / share / workdir：这些是
 * broker 的事；worker 完全不需要 AuthModule 来做 HTTP 路由鉴权（WS 鉴权另
 * 走 ws-authenticate，不经此处）。
 */
export function createWorkerApiRouter(opts: WorkerApiRouterOptions): Router {
  const router = Router();
  router.use(createHealthRoutes());
  router.use(createHookRoutes(opts.integrations));
  return router;
}
