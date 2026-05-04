/**
 * 把 AuthModule 适配成 WsServerOptions.authenticate 钩子
 *
 * WS upgrade 的两条认证路径：
 *  1. URL 携带 ?token=xxx → 直连 verifyToken（用于 attach 客户端，阶段 7 启用）
 *     通过 → 标记 ClientType='attach'
 *  2. 否则走 Cookie Session（webapp 客户端）
 *     通过 → 标记 ClientType='webapp'
 *  任一失败 → 返回 null 让 WsServer 写 401 后 destroy
 *
 * 阶段 2 仅会用到第 2 条路径（cookie），但顺手实现 token 路径，
 * 阶段 7 启用 attach 时无需改动此处。
 */

import type { IncomingMessage } from 'node:http';
import type { ClientType } from '../ws/ws-server.js';
import type { AuthModule } from './auth-middleware.js';
import { logger } from '../logger/logger.js';

/**
 * 创建 WsServer 鉴权回调
 */
export function createWsAuthenticate(authModule: AuthModule) {
  return (req: IncomingMessage): ClientType | null => {
    const host = req.headers.host ?? 'localhost';
    let url: URL;
    try {
      url = new URL(req.url ?? '/', `http://${host}`);
    } catch {
      return null;
    }

    // 路径 1：URL token（attach 客户端）
    const tokenParam = url.searchParams.get('token');
    if (tokenParam) {
      if (authModule.verifyToken(tokenParam)) {
        logger.info({ remoteAddress: req.socket.remoteAddress }, 'WS 通过 URL token 认证（attach）');
        return 'attach';
      }
      logger.warn({ remoteAddress: req.socket.remoteAddress }, 'WS URL token 无效');
      return null;
    }

    // 路径 2：Cookie Session（webapp 客户端）
    const cookieHeader = req.headers.cookie ?? '';
    const sid = authModule.getSessionFromCookieHeader(cookieHeader);
    if (sid && authModule.validateSession(sid)) {
      return 'webapp';
    }

    logger.warn(
      {
        remoteAddress: req.socket.remoteAddress,
        cookieNames: cookieHeader
          .split(';')
          .map((c) => c.trim().split('=')[0])
          .filter(Boolean),
        expectedCookie: authModule.getCookieName(),
      },
      'WS 认证失败：无有效 session 也无 token',
    );
    return null;
  };
}
