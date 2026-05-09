/**
 * /api/hook 路由
 *
 * 接收 Claude Code(或其它 Integration 模块)hook 配置发起的 HTTP POST。
 *
 * 安全约束(关键):
 *  - 仅接收 loopback 来源(127.0.0.1 / ::1 / ::ffff:127.0.0.1)
 *    非 loopback 一律 403——这是 hook 不被局域网内其他设备伪造的关键单点
 *
 * 路由层只做安全校验 + 转发;事件翻译在 IntegrationManager 内部由当前激活
 * 模块负责。模块未激活时仍接收 payload 以便保持 hook 命令一直可用,但返回
 * `ignored: 'no_active_integration'` 让调用方知晓。
 */

import { Router, type Request, type Response } from 'express';
import type { IntegrationManager } from '../integrations/manager.js';
import { ErrorCode } from 'auvezy-terminal-remote-shared';
import { HookError } from '../errors.js';
import { logger } from '../logger/logger.js';

/** 判断请求来源是否是 loopback */
function isLoopback(ip: string): boolean {
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

export function createHookRoutes(integrations: IntegrationManager): Router {
  const router = Router();

  router.post('/hook', (req: Request, res: Response) => {
    const ip = req.ip ?? req.socket.remoteAddress ?? '';

    if (!isLoopback(ip)) {
      logger.warn({ ip }, '/api/hook 拒绝:非 loopback 来源');
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

    const handled = integrations.routeHookPayload(payload);
    if (handled) {
      res.json({ ok: true });
    } else {
      // 模块未激活但 hook 仍能 POST 进来;不算错误,只是没人监听。
      // 例如用户关掉了总开关,但 settings 文件仍存在并被 Claude 调用
      res.json({ ok: true, ignored: 'no_active_integration' });
    }
  });

  return router;
}
