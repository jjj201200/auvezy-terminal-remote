/**
 * /api/instances 路由（broker 端，0.7.0 v2 / API 归属重划分后）
 *
 * 端点：
 *   GET    /instances              列出所有活实例（按 instances.json）
 *   GET    /instances/stream       SSE 实时推送（file watcher 触发）
 *   POST   /instances              异步派生新实例 → 立即返回 202 + instanceId
 *   DELETE /instances/:id          停止指定实例（直接 SIGTERM）
 *
 * 与 v1（worker 端）相比的变化：
 *  - 没有 `currentInstanceId` 概念：broker 是入口，不属于任何 instance
 *  - 不再有 `selfShutdown`：broker 不会"自杀"
 *  - DELETE 直接 `process.kill(pid, 'SIGTERM')`，不再走 HTTP self-shutdown
 *    中转（worker 自己注册了 SIGTERM handler 走 graceful shutdown，足够）
 *  - POST 改异步语义：spawn 后立即 202 返回 `{ instanceId, status: 'pending' }`，
 *    webapp 通过 SSE 等 `status: ready` 事件再 navigate（避免阻塞 fetch
 *    + 让前端 UI 能展示"正在启动…"loading）
 *
 * 老的 worker 端 `createInstanceRoutes` 已删除——worker 不再挂 /api/instances
 * 任何路径。
 */

import { Router, type Request, type Response } from 'express';
import { randomUUID } from 'node:crypto';
import { ErrorCode, type InstanceListItem } from 'auvezy-terminal-remote-shared';
import type { AuthModule } from '../auth/auth-middleware.js';
import type { InstanceRegistryManager } from '../registry/instance-registry.js';
import type { InstanceSpawner, SpawnInstanceInput } from '../registry/instance-spawner.js';
import { onInstanceChange } from '../registry/instance-events.js';
import { nextInstanceName } from '../registry/instance-name.js';
import { InstanceError } from '../errors.js';
import { logger } from '../logger/logger.js';

/**
 * spawn 后等 worker 在 instances.json 出现的最长时间。
 * 超过则视为启动失败：broker 主动 SIGTERM 子进程，避免脏 pending 状态。
 *
 * 30s 比 5s 宽松：覆盖 cwd 复杂、claude 冷启动、慢盘场景。webapp 收 202
 * 后自己看 SSE 等 ready，spawn 慢时 UI 显示 loading；超时则 SSE 推
 * `failed` 事件。
 */
const SPAWN_READY_TIMEOUT_MS = 30_000;

export interface BrokerInstanceRoutesOptions {
  authModule: AuthModule;
  registry: InstanceRegistryManager;
  spawner: InstanceSpawner;
}

export function createBrokerInstanceRoutes(
  opts: BrokerInstanceRoutesOptions,
): Router {
  const router = Router();
  const { authModule, registry, spawner } = opts;

  router.get('/instances', authModule.requireAuth, async (req, res) => {
    logger.debug({ ip: req.ip }, 'GET /instances');
    try {
      const list = await registry.list();
      // broker 不属于任何 instance，isCurrent 永远 false（前端按需用）
      const items: InstanceListItem[] = list.map((i) => ({
        ...i,
        isCurrent: false,
      }));
      res.json({ ok: true, instances: items });
    } catch (err) {
      logger.error({ err }, 'GET /instances 失败');
      const e =
        err instanceof InstanceError
          ? err
          : new InstanceError(ErrorCode.INTERNAL_ERROR, 'failed to read instance registry', 500, err);
      res.status(e.httpStatus).json({ error: e.toPayload() });
    }
  });

  /**
   * GET /instances/stream — SSE
   *
   * instances.json 文件变更 → 推 `event: instances` + 最新 list。
   * 心跳 25s 防代理 / 浏览器 close idle 连接。
   */
  router.get('/instances/stream', authModule.requireAuth, async (req, res) => {
    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();

    const sendSnapshot = async (): Promise<void> => {
      try {
        const list = await registry.list();
        const items: InstanceListItem[] = list.map((i) => ({
          ...i,
          isCurrent: false,
        }));
        res.write(`event: instances\ndata: ${JSON.stringify({ instances: items })}\n\n`);
      } catch (err) {
        logger.warn({ err }, 'SSE snapshot 推送失败（非致命）');
      }
    };

    await sendSnapshot();

    const unsubscribe = onInstanceChange(() => {
      void sendSnapshot();
    });
    const heartbeat = setInterval(() => {
      try {
        res.write(`:keepalive\n\n`);
      } catch {
        /* socket 已关；cleanup 由 close 事件接管 */
      }
    }, 25_000);

    const cleanup = (): void => {
      clearInterval(heartbeat);
      unsubscribe();
    };
    req.on('close', cleanup);
    req.on('aborted', cleanup);
  });

  /**
   * POST /instances — 异步派生
   *
   * 流程：
   *  1. broker 生成 instanceId（UUID）
   *  2. spawner.spawn({ cwd, name, instanceId }) → 子进程启动；env 透传 id
   *  3. 立即返回 202 `{ instanceId, status: 'pending', pid }`
   *  4. webapp 收到后订阅 `/api/instances/stream`，等 instances 列表里
   *     出现该 instanceId（worker self-register）即为 ready
   *  5. broker 内部启 30s 超时 watcher：到时仍未注册 → kill pid + 推 failed
   *
   * 这里**不**等 worker 注册：spawn 已成功 = 进程在跑；ready 是异步事件。
   */
  router.post('/instances', authModule.requireAuth, async (req: Request, res: Response) => {
    const body = req.body as (Partial<SpawnInstanceInput> & { confirmDuplicate?: boolean }) | undefined;
    if (!body || typeof body !== 'object' || typeof body.cwd !== 'string') {
      const e = new InstanceError(
        ErrorCode.CWD_NOT_EXIST,
        'POST /instances requires body.cwd (string)',
        400,
      );
      res.status(e.httpStatus).json({ error: e.toPayload() });
      return;
    }

    // 显式名重名检查（409 两段式）：首次请求不带 confirmDuplicate，撞名则
    // 返回冲突实例信息 + 建议名，前端弹确认；用户选择后带 confirmDuplicate:true
    // 重发放行。未填 name 的实例由 worker register 锁内自动避让，不经此检查。
    const explicitName =
      typeof body.name === 'string' && body.name.trim() ? body.name.trim() : undefined;
    const instanceId = randomUUID();
    try {
      if (explicitName && body.confirmDuplicate !== true) {
        const alive = await registry.list();
        const clash = alive.find((i) => i.name === explicitName);
        if (clash) {
          const e = new InstanceError(
            ErrorCode.INSTANCE_NAME_CONFLICT,
            `instance name '${explicitName}' is already used by a running instance`,
            409,
            undefined,
            {
              suggestion: nextInstanceName(explicitName, alive.map((i) => i.name)),
              existing: {
                name: clash.name,
                pid: clash.pid,
                cwd: clash.cwd,
                startedAt: clash.startedAt,
              },
            },
          );
          res.status(e.httpStatus).json({ error: e.toPayload() });
          return;
        }
      }

      const result = await spawner.spawn({
        cwd: body.cwd,
        ...(explicitName ? { name: explicitName } : {}),
        instanceId,
      });

      // 启动 ready watcher：限时 30s 内 worker 必须自注册到 instances.json
      armReadyTimeout(registry, instanceId, result.pid);

      // 202 Accepted：表示请求已受理，结果异步出现
      res.status(202).json({
        ok: true,
        status: 'pending',
        instance: {
          instanceId,
          pid: result.pid,
          cwd: result.cwd,
          name: result.name,
        },
      });
    } catch (err) {
      logger.error({ err, instanceId }, 'POST /instances failed');
      const e =
        err instanceof InstanceError
          ? err
          : new InstanceError(ErrorCode.INTERNAL_ERROR, 'failed to spawn instance', 500, err);
      res.status(e.httpStatus).json({ error: e.toPayload() });
    }
  });

  /**
   * DELETE /instances/:id — 停止指定实例
   *
   * 直接读 instances.json 拿 pid → SIGTERM。worker 注册了 SIGTERM handler
   * 走 graceful shutdown（清 PTY / unregister / close listener），足够干净。
   *
   * Windows 上 process.kill 是 TerminateProcess 强中断，**listener 不会**
   * 被调用——0.6.x 旧设计为此走 HTTP self-shutdown 让 worker 自己跑清理。
   * 但 0.7.0 worker 不再操作本地 PTY 之外的资源（不用清 stdin raw mode 等
   * 本地终端状态——本地 TerminalRelay 的清理由 worker 自己 SIGINT 路径
   * 触发，跨实例 stop 永远走 detached headless 子进程不需要 stdin 还原）。
   * 所以 SIGTERM 直接送即可。
   */
  router.delete('/instances/:id', authModule.requireAuth, async (req: Request, res: Response) => {
    const id = req.params.id;
    logger.debug({ id, ip: req.ip }, 'DELETE /instances/:id');
    if (!id || typeof id !== 'string') {
      const e = new InstanceError(ErrorCode.CWD_NOT_EXIST, 'instanceId is required', 400);
      res.status(e.httpStatus).json({ error: e.toPayload() });
      return;
    }

    try {
      const all = await registry.list();
      const target = all.find((i) => i.instanceId === id);
      if (!target) {
        const e = new InstanceError(ErrorCode.INTERNAL_ERROR, 'instance not found', 404);
        res.status(e.httpStatus).json({ error: e.toPayload() });
        return;
      }

      let killed = false;
      try {
        process.kill(target.pid, 'SIGTERM');
        killed = true;
      } catch (err) {
        // 进程已死或权限错误 → 视作"已停"，但仍 unregister
        logger.warn({ err, id, pid: target.pid }, 'SIGTERM failed (process may already be dead)');
      }

      // 不等待 worker 自己 unregister：清 best-effort，避免 stale 卡列表
      try {
        await registry.unregister(id);
      } catch {
        /* ignore */
      }

      res.json({ ok: true, outcome: killed ? 'sigterm' : 'already-dead' });
    } catch (err) {
      logger.error({ err, id }, 'DELETE /instances/:id failed');
      const e =
        err instanceof InstanceError
          ? err
          : new InstanceError(ErrorCode.INTERNAL_ERROR, 'failed to stop instance', 500, err);
      res.status(e.httpStatus).json({ error: e.toPayload() });
    }
  });

  return router;
}

/**
 * 启动 SPAWN_READY_TIMEOUT_MS 倒计时；到点若 instances.json 仍无该 id
 * → SIGTERM pid 兜底，避免脏 pending 子进程。
 *
 * 不订阅 onInstanceChange 主动 cancel：file watcher 只在文件变时触发，每个
 * spawn 都自带一个 setTimeout，到点查一次即可，足够轻量。
 */
function armReadyTimeout(
  registry: InstanceRegistryManager,
  instanceId: string,
  pid: number,
): void {
  setTimeout(() => {
    void (async (): Promise<void> => {
      try {
        const list = await registry.list();
        if (list.some((i) => i.instanceId === instanceId)) return; // 已就绪
        logger.warn(
          { instanceId, pid, timeoutMs: SPAWN_READY_TIMEOUT_MS },
          'spawn ready 超时 → SIGTERM 兜底',
        );
        try {
          process.kill(pid, 'SIGTERM');
        } catch {
          /* 已死 */
        }
      } catch (err) {
        logger.warn({ err, instanceId }, 'spawn ready 超时检查失败');
      }
    })();
  }, SPAWN_READY_TIMEOUT_MS).unref();
}
