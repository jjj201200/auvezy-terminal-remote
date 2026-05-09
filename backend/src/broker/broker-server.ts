/**
 * broker server 骨架（0.7.0 阶段 1）
 *
 * 本文件只交付**最小可启 listen + 健康检查**的 Express app，故意不接：
 *  - http-proxy（阶段 3）
 *  - `<base href>` 注入（阶段 4）
 *  - 静态资源 / SPA 入口（阶段 4）
 *  - cookie / auth（阶段 2 worker 改造完成后接 SessionsStore）
 *
 * 这一层的目标是给阶段 3 提供一个**已经能 listen**的载体，后续往上加中间件即可。
 *
 * 与 0.6.x worker 的区别：
 *  - 不创建 PtyManager / WsServer / SessionController
 *  - 不绑 LAN（默认 0.0.0.0:3000，路径反代由阶段 3 接入）
 *  - 不读 ~/.atrrc（broker 自己的配置极少，CLI flag 直接传）
 *
 * 入口形态：
 *  - `createBrokerApp(opts)` 仅创建 Express app，不 listen（便于测试）
 *  - `startBrokerServer(opts)` listen + 写 broker.json + 注册退出钩子
 */

import { createServer, type Server as HttpServer } from 'node:http';
import express, { type Express } from 'express';
import { logger } from '../logger/logger.js';
import {
  clearBrokerState,
  writeBrokerState,
} from './broker-state.js';

/** broker 默认监听端口 */
export const DEFAULT_BROKER_PORT = 3000;

/** broker 默认监听 host（broker 是 LAN 入口，与 worker 的 loopback 相反） */
export const DEFAULT_BROKER_HOST = '0.0.0.0';

export interface BrokerAppOptions {
  /** broker 启动时间戳；不传用 Date.now() */
  startedAt?: number;
  /** broker 进程的 atr 版本（用于 /api/health 回显） */
  brokerVersion: string;
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
export function createBrokerApp(opts: BrokerAppOptions): Express {
  const startedAt = opts.startedAt ?? Date.now();
  const app = express();

  // 基础健康检查：用于 service install 验活、CLI status 探针、CI smoke
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

  return app;
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

  const app = createBrokerApp({
    brokerVersion: opts.brokerVersion,
    startedAt,
  });
  const httpServer = createServer(app);

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
    { port: actualPort, host, brokerVersion: opts.brokerVersion },
    'broker 已启动（骨架，尚未挂载 proxy）',
  );

  return {
    port: actualPort,
    host,
    httpServer,
    async shutdown() {
      process.removeListener('exit', onExit);
      clearBrokerState(opts.statePath);
      await new Promise<void>((res) => {
        httpServer.close(() => res());
      });
      logger.info('broker 已关闭');
    },
  };
}
