/**
 * broker server（0.7.0 v2 / API 归属重划分后）
 *
 * 现在 broker 不只是反代 + 静态资源——它持有"系统级"API：
 *  - /api/health（broker 自己的健康检查）
 *  - /api/auth、/api/config、/api/instances、/api/push、/api/share、/api/workdir-policy
 *  - SSE /api/instances/stream
 *  - `/i/<id>/*` 反代到对应 worker
 *  - 前端静态资源 + base href 注入（base href 仍由 instance-router 处理）
 *
 * 入口形态：
 *  - `createBrokerApp(opts)` 仅创建 Express app，不 listen（便于测试）
 *  - `startBrokerServer(opts)` listen + 写 broker.json + 注册退出钩子
 *
 * 注入依赖：调用方（broker/cli.ts）在启动 broker 进程时构造 AuthModule /
 * SessionsStore / InstanceSpawner / PushService / ConfigStore，并注入进
 * createBrokerApp。详见 design-v2-api-ownership.md §4.2。
 */

import { createServer, type Server as HttpServer } from 'node:http';
import type { Duplex } from 'node:stream';
import type { IncomingMessage } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import express, { type Express } from 'express';
import cors from 'cors';
import { networkInterfaces } from 'node:os';
import { logger } from '../logger/logger.js';
import {
  clearBrokerState,
  writeBrokerState,
} from './broker-state.js';
import {
  createInstanceRouter,
  injectBaseHref,
  type InstanceRouterHandle,
} from './instance-router.js';
import { createBrokerApiRouter } from '../api/router.js';
import type { ConfigStore } from '../api/config-routes.js';
import type { WorkdirPolicySnapshot } from '../api/workdir-policy-routes.js';
import type { AuthModule } from '../auth/auth-middleware.js';
import type { InstanceRegistryManager } from '../registry/instance-registry.js';
import type { InstanceSpawner } from '../registry/instance-spawner.js';
import type { PushService } from '../push/push-service.js';
import type { IntegrationManager } from '../integrations/manager.js';

/** broker 默认监听端口 */
export const DEFAULT_BROKER_PORT = 3000;

/** broker 默认监听 host（broker 是 LAN 入口，与 worker 的 loopback 相反） */
export const DEFAULT_BROKER_HOST = '0.0.0.0';

export interface BrokerAppOptions {
  /** broker 启动时间戳；不传用 Date.now() */
  startedAt?: number;
  /** broker 进程的 atr 版本（用于 /api/health 回显） */
  brokerVersion: string;
  /**
   * worker 实例注册表（用于 `/i/<id>/*` 反代查找）
   *
   * 不传则不挂反代路由（兼容早期"骨架"测试）。
   */
  registry?: InstanceRegistryManager;
  /**
   * 前端 dist 绝对路径
   *
   * 不传则跳过静态服务（broker 仍能跑 /api/health + 反代，但根路径返回 404）。
   * base href 注入由 instance-router 处理，只在此路径下生效。
   */
  frontendDist?: string;
  /**
   * broker 端 /api 系统级路由依赖；不传则不挂这些路由（broker 仍能跑反代 +
   * 静态，但 webapp 无法登录 / 列实例 / 推订阅）。
   *
   * 生产路径：broker/cli.ts 在 runBrokerStart 里 new 出全部依赖再注入。
   * 测试路径：早期 broker-server.test.ts 不传这个，仅验证骨架。
   */
  brokerApi?: BrokerApiDeps;
}

/**
 * broker /api 路由依赖（系统级 API）
 *
 * 由 broker/cli.ts 在启动时构造：AuthModule + SessionsStore（共享）、
 * InstanceSpawner（cliJsPath 解析到 dist/cli.js）、PushService、ConfigStore、
 * IntegrationManager（broker 自己也持一份用于 /api/hook 反代过来的 echo——
 * 但实际上 hook 在 worker 端处理，不会到 broker；这里 IntegrationManager
 * 仅作占位，未来若有 broker 直接接收 hook 的需求再启用）。
 */
export interface BrokerApiDeps {
  authModule: AuthModule;
  configStore: ConfigStore;
  spawner: InstanceSpawner;
  pushService: PushService;
  /** broker 监听端口（share endpoints 等需要） */
  brokerPort: number;
  /** broker 监听 host 的展示 IP（detectDisplayIp 结果） */
  displayIp: string;
  workdirPolicy: () => WorkdirPolicySnapshot;
  /** 给前端 hook routes 用；broker 端通常不挂 hook，但保留接口完整性 */
  integrations?: IntegrationManager;
}

export interface BrokerServerOptions extends BrokerAppOptions {
  /** 监听端口；默认 3000 */
  port?: number;
  /** 监听 host；默认 0.0.0.0 */
  host?: string;
  /** broker.json 路径；默认 `~/.atr/broker.json` */
  statePath?: string;
}

/**
 * 创建 broker Express app（不 listen）
 *
 * 当前只挂 `/api/health`。阶段 3 / 4 会在此基础上加 proxy / 静态资源 / base-href 注入。
 *
 * 设计：故意**不**用 cors() 中间件——broker 是同源服务（前端从 broker URL
 * 加载，再 fetch 同源 api），不应有跨源请求。0.6.x 的 cors 是对历史 LAN 多端口
 * 双轨场景的兜底，0.7.0 没那个需求了。
 */
export function createBrokerApp(
  opts: BrokerAppOptions,
): { app: Express; instanceRouter: InstanceRouterHandle | null } {
  const startedAt = opts.startedAt ?? Date.now();
  const app = express();

  // 0.7.0 v2：broker 接 webapp 直发的 /api/auth POST 等，需要 JSON body 解析
  app.use(express.json());

  // CORS：与 worker 同样策略（同源 + 本机所有网卡 IP）。webapp 单 PWA
  // 模型下绝大多数请求是同源；保险起见放开本机网卡 IP 兜底（用户从
  // Tailscale / VPN / 临时 IP 访问 broker 都能命中）。
  const localHostnames = collectLocalHostnames();
  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin) {
          callback(null, true);
          return;
        }
        try {
          const url = new URL(origin);
          if (localHostnames.has(url.hostname)) {
            callback(null, true);
            return;
          }
        } catch {
          /* invalid origin → 拒 */
        }
        callback(new Error('CORS 拒绝：origin 不在白名单'));
      },
      credentials: true,
    }),
  );

  // broker 自己的 /api/health：必须在 broker /api 路由之前注册——它来自
  // broker-server 内联实现（含 role/brokerVersion 等），与 createHealthRoutes
  // 通用版语义不同。
  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      role: 'broker',
      pid: process.pid,
      brokerVersion: opts.brokerVersion,
      startedAt,
      uptimeMs: Date.now() - startedAt,
    });
  });

  // broker 系统级 /api 路由（auth / config / instances / push / share /
  // workdir-policy / SSE）。注入式：测试场景不传 brokerApi 即跳过。
  if (opts.brokerApi) {
    app.use(
      '/api',
      createBrokerApiRouter({
        authModule: opts.brokerApi.authModule,
        configStore: opts.brokerApi.configStore,
        registry: opts.registry!,
        spawner: opts.brokerApi.spawner,
        pushService: opts.brokerApi.pushService,
        brokerPort: opts.brokerApi.brokerPort,
        displayIp: opts.brokerApi.displayIp,
        workdirPolicy: opts.brokerApi.workdirPolicy,
      }),
    );
    if (!opts.registry) {
      logger.warn('brokerApi 提供但 registry 为空——/api/instances 会运行时 NPE');
    }
  }

  // `/i/<id>/*` 反代；只有提供 registry 时才挂
  let instanceRouter: InstanceRouterHandle | null = null;
  if (opts.registry) {
    instanceRouter = createInstanceRouter({ registry: opts.registry });
    app.use(instanceRouter.middleware);
  }

  // 静态前端 + SPA fallback
  //
  // 顺序：
  //   1. instance-router 已经把 `/i/<id>/api/*` 与 `/i/<id>/ws` 反代到 worker
  //   2. instance-router 把 `/i/<id>/*` 下的非 worker 路径（HTML / asset）
  //      改写 req.url 为子路径（如 `/`、`/assets/index.js`）+ 挂 __atrInstanceId
  //      next() 到这里
  //   3. express.static 用 broker frontend-dist 服务这些子路径
  //   4. 最后 SPA fallback：未命中 static 的非 API 路径返回 index.html，
  //      若挂了 __atrInstanceId 则注入对应的 `<base href="/i/<id>/">`
  if (opts.frontendDist && existsSync(opts.frontendDist)) {
    const dist = opts.frontendDist;
    app.use(
      express.static(dist, {
        // 关键：不让 static 自动响应 `/` → index.html，让 SPA fallback 处理
        // index.html，否则 instance-router 改 req.url 为 `/` 后 static 直接返
        // 回 index.html，跳过 base href 注入
        index: false,
        setHeaders: (res, filePath) => {
          if (filePath.endsWith('.webmanifest')) {
            res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
          }
        },
      }),
    );
    app.get('*', (req, res, next) => {
      // /api、/ws 永不走 SPA fallback；/i/ 不会到这里（instance-router 已 rewrite）
      if (req.path.startsWith('/api') || req.path.startsWith('/ws')) {
        return next();
      }
      const indexPath = resolve(dist, 'index.html');
      const instanceId = (req as { __atrInstanceId?: string }).__atrInstanceId;
      if (!instanceId) {
        // broker 根：直接 sendFile，不注 base href（前端默认 base ='./'）
        res.sendFile(indexPath);
        return;
      }
      // 实例特定路径：读 index.html → 注入 `<base href="/i/<id>/">` → 发回
      try {
        const html = readFileSync(indexPath, 'utf-8');
        const injected = injectBaseHref(html, `/i/${instanceId}/`);
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache');
        res.send(injected);
      } catch (err) {
        logger.warn({ err, indexPath }, 'index.html 读取失败');
        res.status(500).send('Internal Server Error');
      }
    });
    logger.info({ path: dist }, 'broker 前端静态文件已挂载');
  } else if (opts.frontendDist) {
    logger.warn({ expected: opts.frontendDist }, 'broker 前端 dist 不存在，跳过静态服务');
  }

  return { app, instanceRouter };
}

/** startBrokerServer 返回的运行时句柄 */
export interface BrokerServerHandle {
  /** 实际监听的端口（OS 自动分配时也以此为准） */
  port: number;
  /** 实际监听的 host */
  host: string;
  /** 底层 HttpServer，便于挂 WS upgrade（阶段 3） */
  httpServer: HttpServer;
  /** 优雅关闭：close + 清 broker.json */
  shutdown(): Promise<void>;
}

/**
 * 启动 broker server：listen → 写 broker.json → 注册退出钩子
 *
 * **注意**：本函数不做 ensure / file-lock 抢占——多 broker 抢占的逻辑放在
 * 阶段 2 的 ensureBroker 里（worker 启动时调用）。本函数假设调用者已经持有
 * 资格。
 *
 * 退出策略：
 *  - SIGTERM / SIGINT 不在此处统一捕获——broker 后续会有自己的 shutdown 逻辑
 *    （阶段 3 + service install）；本骨架仅提供 shutdown() 给调用方。
 *  - process.on('exit') 同步清 broker.json，避免崩溃后留下"看似活着"的状态。
 */
export async function startBrokerServer(
  opts: BrokerServerOptions,
): Promise<BrokerServerHandle> {
  const port = opts.port ?? DEFAULT_BROKER_PORT;
  const host = opts.host ?? DEFAULT_BROKER_HOST;
  const startedAt = opts.startedAt ?? Date.now();

  const { app, instanceRouter } = createBrokerApp({
    brokerVersion: opts.brokerVersion,
    startedAt,
    ...(opts.registry ? { registry: opts.registry } : {}),
    ...(opts.frontendDist ? { frontendDist: opts.frontendDist } : {}),
    ...(opts.brokerApi ? { brokerApi: opts.brokerApi } : {}),
  });
  const httpServer = createServer(app);

  // WS upgrade 反代：只在挂了 instance-router 时启用
  if (instanceRouter) {
    const router = instanceRouter; // narrow 给闭包
    httpServer.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
      // 必须在 handleUpgrade 改写 req.url 之前判前缀；命中即交给反代，
      // 反代后 req.url 会被改写成 worker-side 路径（不再以 /i/ 起头）
      const url = req.url ?? '';
      if (url.startsWith('/i/')) {
        router.handleUpgrade(req, socket, head);
        return;
      }
      // broker 进程内目前没别的 upgrade 来源，未识别路径直接 destroy 避免悬挂
      socket.destroy();
    });
  }

  await new Promise<void>((resolveListen, rejectListen) => {
    const onError = (err: Error) => {
      httpServer.removeListener('listening', onListening);
      rejectListen(err);
    };
    const onListening = () => {
      httpServer.removeListener('error', onError);
      resolveListen();
    };
    httpServer.once('error', onError);
    httpServer.once('listening', onListening);
    httpServer.listen(port, host);
  });

  const addr = httpServer.address();
  const actualPort = typeof addr === 'object' && addr ? addr.port : port;

  writeBrokerState(
    {
      pid: process.pid,
      port: actualPort,
      host,
      startedAt,
      brokerVersion: opts.brokerVersion,
    },
    opts.statePath,
  );

  // 进程异常退出兜底：尽量删 broker.json，避免下次 ensure 误判存活
  const onExit = (): void => {
    clearBrokerState(opts.statePath);
  };
  process.once('exit', onExit);

  logger.info(
    {
      port: actualPort,
      host,
      brokerVersion: opts.brokerVersion,
      withProxy: instanceRouter !== null,
    },
    'broker 已启动',
  );

  return {
    port: actualPort,
    host,
    httpServer,
    async shutdown() {
      process.removeListener('exit', onExit);
      instanceRouter?.close();
      clearBrokerState(opts.statePath);
      await new Promise<void>((res) => {
        httpServer.close(() => res());
      });
      logger.info('broker 已关闭');
    },
  };
}

/**
 * 收集本机所有网卡 IPv4/IPv6 + localhost / 127.0.0.1 → CORS 白名单
 *
 * 与 worker 端 collectLocalHostnames 同语义，重复实现是为了让 broker 进程
 * 不依赖 worker 的 index.ts。
 */
function collectLocalHostnames(): Set<string> {
  const set = new Set<string>(['localhost', '127.0.0.1', '::1']);
  const ifaces = networkInterfaces();
  for (const list of Object.values(ifaces)) {
    if (!list) continue;
    for (const info of list) {
      if (info.internal) continue;
      set.add(info.address);
    }
  }
  const extra = process.env['OCR_CORS_ALLOW'];
  if (extra) {
    for (const h of extra.split(',').map((s) => s.trim()).filter(Boolean)) {
      set.add(h);
    }
  }
  return set;
}
