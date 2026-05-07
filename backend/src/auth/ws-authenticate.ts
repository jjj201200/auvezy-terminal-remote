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
      // debug 级：旧 URL / token 改了之后浏览器自动重连会反复触发，不应刷屏
      logger.debug({ remoteAddress: req.socket.remoteAddress }, 'WS URL token 无效');
      return null;
    }

    // 路径 2：Cookie Session（webapp 客户端）
    const cookieHeader = req.headers.cookie ?? '';
    const sid = authModule.getSessionFromCookieHeader(cookieHeader);
    if (sid && authModule.validateSession(sid)) {
      return 'webapp';
    }

    // debug 级：cookie 过期 / 多 tab 时序竞争 / 跨设备旧 cookie 都属预期失败，
    // 默认 LOG_LEVEL=info 时不输出，避免污染 PowerShell PTY 终端。
    // 排查时用 LOG_LEVEL=debug 仍可看到完整 cookieNames / expectedCookie。
    logger.debug(
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
