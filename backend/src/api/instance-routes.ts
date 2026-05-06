/**
 * /api/instances 路由
 *
 * 端点：
 *   GET  /instances           列出当前用户所有活实例（含 isCurrent 标记）
 *   POST /instances           派生新实例（headless 模式）—— 阶段 6a.4 加上
 *
 * 设计：
 *  - 全部需要鉴权（authModule.requireAuth）
 *  - isCurrent 由 currentInstanceId 计算：注入到工厂里，比每次取全局更纯
 *  - 派生新实例的 spawner 注入式：单测可 mock；生产由 index.ts 传入真实 InstanceSpawner
 */

import { Router, type Request, type Response } from 'express';
import { ErrorCode, type InstanceListItem } from '@otr/shared';
import type { AuthModule } from '../auth/auth-middleware.js';
import type { InstanceRegistryManager } from '../registry/instance-registry.js';
import type { InstanceSpawner, SpawnInstanceInput } from '../registry/instance-spawner.js';
import { stopInstances } from '../registry/stop-instances.js';
import { InstanceError } from '../errors.js';
import { logger } from '../logger/logger.js';

export interface InstanceRoutesOptions {
  authModule: AuthModule;
  registry: InstanceRegistryManager;
  /** 当前进程的 instanceId，用于在 list 中标记 isCurrent */
  currentInstanceId: string;
  /** 派生新实例；不传则 POST /instances 返回 501 */
  spawner?: InstanceSpawner;
}

export function createInstanceRoutes(opts: InstanceRoutesOptions): Router {
  const router = Router();
  const { authModule, registry, currentInstanceId } = opts;

  router.get('/instances', authModule.requireAuth, async (req, res) => {
    logger.debug({ ip: req.ip }, 'GET /instances');
    try {
      const list = await registry.list();
      const items: InstanceListItem[] = list.map((i) => ({
        ...i,
        isCurrent: i.instanceId === currentInstanceId,
      }));
      res.json({ ok: true, instances: items });
    } catch (err) {
      logger.error({ err }, 'GET /instances 失败');
      const e =
        err instanceof InstanceError
          ? err
          : new InstanceError(ErrorCode.INTERNAL_ERROR, '注册表读取失败', 500, err);
      res.status(e.httpStatus).json({ error: e.toPayload() });
    }
  });

  router.post('/instances', authModule.requireAuth, async (req: Request, res: Response) => {
    if (!opts.spawner) {
      // 派生器未注入（headless 创建在某些场景关闭）
      const e = new InstanceError(
        ErrorCode.INTERNAL_ERROR,
        '当前部署不支持 Web 创建实例',
        501,
      );
      res.status(e.httpStatus).json({ error: e.toPayload() });
      return;
    }

    const body = req.body as Partial<SpawnInstanceInput> | undefined;
    if (!body || typeof body !== 'object' || typeof body.cwd !== 'string') {
      const e = new InstanceError(
        ErrorCode.CWD_NOT_EXIST,
        'POST /instances 需要 body.cwd（字符串）',
        400,
      );
      res.status(e.httpStatus).json({ error: e.toPayload() });
      return;
    }

    try {
      const result = await opts.spawner.spawn({
        cwd: body.cwd,
        name: typeof body.name === 'string' ? body.name : undefined,
      });
      res.json({ ok: true, instance: result });
    } catch (err) {
      logger.error({ err }, 'POST /instances 失败');
      const e =
        err instanceof InstanceError
          ? err
          : new InstanceError(ErrorCode.INTERNAL_ERROR, '派生实例失败', 500, err);
      res.status(e.httpStatus).json({ error: e.toPayload() });
    }
  });

  /**
   * DELETE /instances/:id
   *
   * 停止指定实例（SIGTERM → 宽限期 → SIGKILL）。当前实例不能停自己——会让 master
   * 进程一并死亡，导致其他客户端断开。前端禁止通过 UI 触发；后端额外校验。
   */
  router.delete('/instances/:id', authModule.requireAuth, async (req: Request, res: Response) => {
    const id = req.params.id;
    logger.info({ id, ip: req.ip, currentInstanceId }, 'DELETE /instances/:id 进入');
    if (!id || typeof id !== 'string') {
      const e = new InstanceError(ErrorCode.CWD_NOT_EXIST, 'instanceId 必填', 400);
      res.status(e.httpStatus).json({ error: e.toPayload() });
      return;
    }
    if (id === currentInstanceId) {
      const e = new InstanceError(
        ErrorCode.INTERNAL_ERROR,
        '不能通过 API 停止当前实例（会让连接你自己的进程退出）',
        400,
      );
      res.status(e.httpStatus).json({ error: e.toPayload() });
      return;
    }

    try {
      const all = await registry.list();
      const target = all.find((i) => i.instanceId === id);
      if (!target) {
        const e = new InstanceError(ErrorCode.INTERNAL_ERROR, '实例不存在', 404);
        res.status(e.httpStatus).json({ error: e.toPayload() });
        return;
      }
      // stopInstances 的 pattern 走 substring 匹配 name/cwd/host:port，
      // 不能用 instanceId（uuid 不会匹配任何字段）。改用 host:port 唯一定位
      const pattern = `${target.host}:${target.port}`;
      const results = await stopInstances(pattern, { registry });
      const r = results.find((x) => x.instance.instanceId === id);
      if (!r) {
        const e = new InstanceError(
          ErrorCode.INTERNAL_ERROR,
          `stopInstances 未命中 ${pattern}`,
          500,
        );
        res.status(e.httpStatus).json({ error: e.toPayload() });
        return;
      }
      res.json({ ok: true, outcome: r.outcome });
    } catch (err) {
      logger.error({ err, id }, 'DELETE /instances/:id 失败');
      const e =
        err instanceof InstanceError
          ? err
          : new InstanceError(ErrorCode.INTERNAL_ERROR, '停止实例失败', 500, err);
      res.status(e.httpStatus).json({ error: e.toPayload() });
    }
  });

  return router;
}
