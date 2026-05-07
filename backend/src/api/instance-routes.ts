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
import { ErrorCode, type InstanceInfo, type InstanceListItem } from 'auvezy-terminal-remote-shared';
import type { AuthModule } from '../auth/auth-middleware.js';
import type { InstanceRegistryManager } from '../registry/instance-registry.js';
import type { InstanceSpawner, SpawnInstanceInput } from '../registry/instance-spawner.js';
import { stopInstances } from '../registry/stop-instances.js';
import { onInstanceChange } from '../registry/instance-events.js';
import { InstanceError } from '../errors.js';
import { logger } from '../logger/logger.js';

/**
 * 调目标实例的 POST /instances/self/shutdown，让对方自己跑 graceful shutdown。
 * 关键场景是 Windows：那里 process.kill('SIGTERM') 直接 TerminateProcess，
 * 目标进程没机会跑 stdin/stdout 还原，本地 PowerShell 终端会卡死空屏。
 *
 * 用 loopback 127.0.0.1（同机实例必然 bind 在 0.0.0.0 / 127.0.0.1，target.host
 * 可能是 LAN/Tailscale IP 当前主机不一定能直连），鉴权用 shared token。
 *
 * 返回 true = 对端 200；false = 任何失败（超时/连接拒绝/非 2xx）。
 * 故意 swallow 错误：失败由调用方走 fallback 路径（process.kill）。
 */
async function tryHttpSelfShutdown(target: InstanceInfo, token: string): Promise<boolean> {
  const url = `http://127.0.0.1:${target.port}/api/instances/self/shutdown?token=${encodeURIComponent(token)}`;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 3000);
  try {
    const r = await fetch(url, { method: 'POST', signal: ac.signal });
    return r.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export interface InstanceRoutesOptions {
  authModule: AuthModule;
  registry: InstanceRegistryManager;
  /** 当前进程的 instanceId，用于在 list 中标记 isCurrent */
  currentInstanceId: string;
  /** 派生新实例；不传则 POST /instances 返回 501 */
  spawner?: InstanceSpawner;
  /**
   * 触发本进程跑优雅 shutdown（同 SIGTERM 走的那一路）。
   * 提供后才会注册 POST /instances/self/shutdown。
   * Windows 上 process.kill 触发不了 listener，只能这种方式让目标实例自杀清理。
   */
  selfShutdown?: () => void;
  /**
   * 共享 token：用于在 DELETE /instances/:id 时调用目标实例的 self-shutdown HTTP。
   * 不传则跳过 HTTP 路径，直接走 process.kill 兼容路径（Linux/Mac 完全够用，
   * Windows 上目标进程不会跑清理代码 → 可能在目标的本地终端留下脏状态）。
   */
  sharedToken?: string;
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

  /**
   * GET /instances/stream — SSE
   *
   * instances.json 文件变更（任何 backend 调 register/unregister/list-with-prune）
   * → 推一条 event: 'instances' + 最新 list 给所有连着的客户端。
   *
   * 鉴权：cookie（EventSource 不支持自定义 header，credentials:include 即走 cookie）。
   * 心跳：每 25s 发 `:keepalive` 注释行，避免代理 / 浏览器 close idle 连接。
   */
  router.get('/instances/stream', authModule.requireAuth, async (req, res) => {
    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // 防 nginx 缓冲（即使我们没 nginx，加上无害）
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();

    // 推一条当前快照，让客户端不必再单独调 GET 拉一次
    const sendSnapshot = async (): Promise<void> => {
      try {
        const list = await registry.list();
        const items: InstanceListItem[] = list.map((i) => ({
          ...i,
          isCurrent: i.instanceId === currentInstanceId,
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
    logger.debug({ id, ip: req.ip, currentInstanceId }, 'DELETE /instances/:id');
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

      // 先尝试 HTTP self-shutdown（Windows 上 process.kill 走不通的关键路径）
      // 注：Linux/Mac 上 process.kill('SIGTERM') 完全 OK，但走 HTTP 同样能让目标
      // 跑完整清理路径而不是被 SIGTERM 强中断 listener 之外的代码——更干净，
      // 所以不分平台都先试 HTTP；失败 fallback 到 process.kill。
      if (opts.sharedToken) {
        const httpOk = await tryHttpSelfShutdown(target, opts.sharedToken);
        if (httpOk) {
          // 实例可能不会立即从 registry 消失，由对方进程退出时 unregister 处理；
          // 这里也尝试清掉条目（best-effort）——避免 stale 卡列表
          try {
            await registry.unregister(id);
          } catch {
            /* ignore */
          }
          res.json({ ok: true, outcome: 'sigterm' });
          return;
        }
        logger.warn(
          { id, host: target.host, port: target.port },
          'HTTP self-shutdown 失败，fallback 到 process.kill',
        );
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

  // 自关闭：让本进程跑 shutdown(0)，回 200 后下一个 tick 真正清理。
  // 鉴权用 URL token（共享 token），因为发起方是另一个 atr 实例的 backend，
  // 没有 cookie session，但持有 shared token。
  if (opts.selfShutdown) {
    const triggerSelfShutdown = opts.selfShutdown;
    router.post('/instances/self/shutdown', (req, res) => {
      const token = typeof req.query['token'] === 'string' ? req.query['token'] : '';
      if (!token || !authModule.verifyToken(token)) {
        res.status(401).json({ error: { code: ErrorCode.AUTH_INVALID_TOKEN, message: 'invalid token' } });
        return;
      }
      logger.info({ ip: req.ip }, 'POST /instances/self/shutdown');
      // 先 200，再下一个 tick 跑 shutdown：让响应体到达对端
      res.json({ ok: true });
      setImmediate(() => triggerSelfShutdown());
    });
  }

  return router;
}
