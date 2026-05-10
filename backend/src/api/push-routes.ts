/**
 * /api/push 路由
 *
 * 端点：
 *   GET    /push/vapid                   返回 VAPID 公钥（无需鉴权——本身就是 public key）
 *   POST   /push/subscriptions           注册订阅（鉴权）
 *   DELETE /push/subscriptions           注销订阅（鉴权）；body.endpoint 必填
 *
 * 设计：
 *  - VAPID 公钥不需要鉴权：它定义就是 public，前端 getPublicKey 才能订阅
 *  - 订阅 CRUD 必须鉴权：避免任意来源恶意写入订阅列表造成"假推送"
 */

import { Router, type Request, type Response } from 'express';
import { ErrorCode } from 'auvezy-terminal-remote-shared';
import type { AuthModule } from '../auth/auth-middleware.js';
import { PushService, type PushSubscriptionInfo } from '../push/push-service.js';
import { PushError } from '../errors.js';
import { logger } from '../logger/logger.js';
import { getEntryUrl } from '../broker/forwarded-headers.js';

export function createPushRoutes(authModule: AuthModule, push: PushService): Router {
  const router = Router();

  router.get('/push/vapid', (_req: Request, res: Response) => {
    try {
      res.json({ ok: true, publicKey: push.getPublicKey() });
    } catch (err) {
      const e =
        err instanceof PushError
          ? err
          : new PushError(ErrorCode.INTERNAL_ERROR, '获取 VAPID 失败', 500, err);
      res.status(e.httpStatus).json({ error: e.toPayload() });
    }
  });

  router.post(
    '/push/subscriptions',
    authModule.requireAuth,
    (req: Request, res: Response) => {
      const body = req.body as Partial<PushSubscriptionInfo> | undefined;
      if (!body || typeof body !== 'object') {
        const e = new PushError(
          ErrorCode.PUSH_SUBSCRIPTION_INVALID,
          '订阅 body 必须是 JSON 对象',
          400,
        );
        res.status(e.httpStatus).json({ error: e.toPayload() });
        return;
      }
      try {
        // 0.7.0：订阅那一刻确定 entry URL（从 X-ATR-Forwarded-* 头反推）。
        // 用户从哪个 host 订阅就跳回哪个 host；多设备 / 多反代域名各走各的
        const incoming = body as PushSubscriptionInfo;
        const subscription: PushSubscriptionInfo = {
          ...incoming,
          entryUrl: getEntryUrl(req),
        };
        push.subscribe(subscription);
        res.json({ ok: true });
      } catch (err) {
        const e =
          err instanceof PushError
            ? err
            : new PushError(ErrorCode.INTERNAL_ERROR, '订阅失败', 500, err);
        logger.warn({ err }, '订阅失败');
        res.status(e.httpStatus).json({ error: e.toPayload() });
      }
    },
  );

  router.delete(
    '/push/subscriptions',
    authModule.requireAuth,
    (req: Request, res: Response) => {
      const body = req.body as { endpoint?: unknown } | undefined;
      const endpoint = typeof body?.endpoint === 'string' ? body.endpoint : '';
      if (!endpoint) {
        const e = new PushError(
          ErrorCode.PUSH_SUBSCRIPTION_INVALID,
          '取消订阅需要 body.endpoint',
          400,
        );
        res.status(e.httpStatus).json({ error: e.toPayload() });
        return;
      }
      const removed = push.unsubscribe(endpoint);
      res.json({ ok: true, removed });
    },
  );

  return router;
}
