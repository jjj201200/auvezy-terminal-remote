/**
 * /api/hook 路由
 *
 * 接收 Claude Code hook 配置发起的 HTTP POST。
 *
 * 安全约束（关键）：
 * - 仅接收 loopback 来源（127.0.0.1 / ::1 / ::ffff:127.0.0.1）
 *   非 loopback 一律 403——这是审批通知不被局域网内其他设备伪造的关键单点
 *
 * 不在本路由内做的事：
 * - 业务逻辑（HookReceiver.processHook）
 * - 状态广播（SessionController 监听 'notification' 事件）
 */

import { Router, type Request, type Response } from 'express';
import type { HookReceiver } from '../hooks/hook-receiver.js';
import { ErrorCode } from '@ocr/shared';
import { HookError } from '../errors.js';
import { logger } from '../logger/logger.js';

/** 判断请求来源是否是 loopback */
function isLoopback(ip: string): boolean {
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

export function createHookRoutes(receiver: HookReceiver): Router {
  const router = Router();

  router.post('/hook', (req: Request, res: Response) => {
    const ip = req.ip ?? req.socket.remoteAddress ?? '';

    if (!isLoopback(ip)) {
      logger.warn({ ip }, '/api/hook 拒绝：非 loopback 来源');
      const err = new HookError(
        ErrorCode.HOOK_NON_LOCALHOST,
        '/api/hook 仅接受 localhost 调用',
        403,
      );
      res.status(err.httpStatus).json({ error: err.toPayload() });
      return;
    }

    const payload = req.body;
    if (!payload || typeof payload !== 'object') {
      const err = new HookError(
        ErrorCode.HOOK_INVALID_PAYLOAD,
        'hook payload 必须是 JSON 对象',
        400,
      );
      res.status(err.httpStatus).json({ error: err.toPayload() });
      return;
    }

    const result = receiver.processHook(payload);
    if (result.type === 'notification') {
      res.json({ ok: true, tool: result.notification.tool });
    } else {
      res.json({ ok: true, ignored: true, reason: result.reason });
    }
  });

  return router;
}
