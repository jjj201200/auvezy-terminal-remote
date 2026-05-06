/**
 * AuthModule
 *
 * Token + Session Cookie 认证模块。
 *
 * 流程：
 *  1. 客户端 POST /api/auth { token } → AuthModule.handleAuth
 *  2. 限流检查 → timingSafeEqual 比对 → 通过则创建 Session + Set-Cookie → 200
 *  3. 后续请求带 Cookie → requireAuth 中间件校验 Session 有效期
 *  4. WS upgrade 阶段：从 raw header 取 cookie → 校验 Session
 *
 * 关键安全设计：
 *  - timingSafeEqual：防时序侧信道，先比长度再比内容
 *  - Session 存内存 Map，TTL 通过"取出时检查 createdAt"惰性失效
 *  - Cookie：HttpOnly + SameSite=Lax + secure 跟协议自适应
 *  - cookieName 后缀绑端口（多实例 Cookie 隔离的关键单点）
 *  - 限流成功后清零（合法用户不会被自己之前的失败卡死）
 */

import type { Request, Response, NextFunction } from 'express';
import { timingSafeEqual } from 'node:crypto';
import * as cookie from 'cookie';
import { ErrorCode } from 'auvezy-terminal-remote-shared';
import { generateSessionId } from './token-generator.js';
import { RateLimiter } from './rate-limiter.js';
import { logger } from '../logger/logger.js';
import { AuthError } from '../errors.js';

export interface AuthModuleOptions {
  /** 当前实例使用的 token（已由 shared-token 决定来源） */
  token: string;
  /** Session 有效期（毫秒） */
  sessionTtlMs: number;
  /** 限流：每 IP 每分钟最大尝试次数 */
  rateLimitPerMinute: number;
  /** Cookie 名（多实例必须按端口生成不同名） */
  cookieName: string;
}

interface SessionEntry {
  createdAt: number;
  ip: string;
}

/**
 * 生成 cookie 名（带端口后缀防多实例 Cookie 串）
 *
 * 例：port=3001 → 'session_id_p3001'
 */
export function createSessionCookieName(port: number): string {
  return `session_id_p${port}`;
}

export class AuthModule {
  private readonly token: string;
  private readonly sessionTtlMs: number;
  private readonly cookieName: string;
  private readonly sessions = new Map<string, SessionEntry>();
  private readonly rateLimiter: RateLimiter;

  constructor(opts: AuthModuleOptions) {
    this.token = opts.token;
    this.sessionTtlMs = opts.sessionTtlMs;
    this.cookieName = opts.cookieName;
    this.rateLimiter = new RateLimiter(opts.rateLimitPerMinute);
  }

  // ──────────────── 公共 API ────────────────

  /**
   * 时序安全的 token 比对
   *
   * 先比长度（不同直接 false）；相同则用 timingSafeEqual 恒定时间比较，
   * 防止攻击者通过响应耗时差异推断 token 字符
   */
  verifyToken(candidate: string): boolean {
    const a = Buffer.from(this.token, 'utf-8');
    const b = Buffer.from(candidate, 'utf-8');
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }

  /** 创建 session 并返回 sessionId */
  createSession(ip: string): string {
    const sid = generateSessionId();
    this.sessions.set(sid, { createdAt: Date.now(), ip });
    logger.info({ ip }, '已创建 session');
    return sid;
  }

  /**
   * 校验 session 是否有效（且未过期）
   *
   * 过期的 session 顺手删除（惰性清理）
   */
  validateSession(sessionId: string): boolean {
    const entry = this.sessions.get(sessionId);
    if (!entry) return false;
    if (Date.now() - entry.createdAt > this.sessionTtlMs) {
      this.sessions.delete(sessionId);
      return false;
    }
    return true;
  }

  /** 从 Express Request 取 sessionId */
  getSessionFromRequest(req: Request): string | null {
    const cookies = cookie.parse(req.headers.cookie ?? '');
    return cookies[this.cookieName] ?? null;
  }

  /** 从原始 cookie header 字符串取 sessionId（WS upgrade 用） */
  getSessionFromCookieHeader(cookieHeader: string): string | null {
    const cookies = cookie.parse(cookieHeader);
    return cookies[this.cookieName] ?? null;
  }

  /** 当前 cookie 名（供日志诊断） */
  getCookieName(): string {
    return this.cookieName;
  }

  /**
   * Express 中间件：要求请求带有效 Session
   *
   * 失败返回 401 JSON
   */
  requireAuth = (req: Request, res: Response, next: NextFunction): void => {
    const sid = this.getSessionFromRequest(req);
    if (!sid || !this.validateSession(sid)) {
      // debug 级：cookie 过期 / 未登录是预期错误，401 响应已经告知客户端
      // （之前是 warn，浏览器轮询时会刷屏污染日志）
      logger.debug(
        { path: req.path, hasCookie: Boolean(sid) },
        '认证失败：无有效 session',
      );
      const err = new AuthError(
        sid ? ErrorCode.AUTH_SESSION_EXPIRED : ErrorCode.AUTH_TOKEN_MISSING,
        sid ? 'Session 已过期' : '未携带有效凭证',
        401,
      );
      res.status(err.httpStatus).json({ error: err.toPayload() });
      return;
    }
    next();
  };

  /**
   * /api/auth 处理函数
   *
   * 流程：取 IP → 限流 → 校验 token → 创建 session → 重置限流 → Set-Cookie
   */
  handleAuth = (req: Request, res: Response): void => {
    const ip = req.ip ?? req.socket.remoteAddress ?? 'unknown';

    if (!this.rateLimiter.attempt(ip)) {
      const err = new AuthError(
        ErrorCode.AUTH_RATE_LIMITED,
        '请求过于频繁，请稍后再试',
        429,
      );
      res.status(err.httpStatus).json({ error: err.toPayload() });
      return;
    }

    const candidate = (req.body as { token?: unknown })?.token;
    if (typeof candidate !== 'string' || !this.verifyToken(candidate)) {
      const err = new AuthError(
        ErrorCode.AUTH_INVALID_TOKEN,
        'Token 无效',
        401,
      );
      // info 级而非 warn：用户携带过期/错误 token 是预期事件（缓存失效、复制错、
      // 多实例之间共享 token 但其中一个重启），不应该当成"可疑事件"打 warn 噪音
      logger.info({ ip }, '认证失败：token 无效');
      res.status(err.httpStatus).json({ error: err.toPayload() });
      return;
    }

    const sid = this.createSession(ip);
    // 合法用户清零限流计数（防止之前误输导致后续被卡）
    this.rateLimiter.reset(ip);

    res.setHeader(
      'Set-Cookie',
      cookie.serialize(this.cookieName, sid, {
        httpOnly: true,
        secure: req.protocol === 'https',
        sameSite: 'lax',
        path: '/',
        maxAge: Math.floor(this.sessionTtlMs / 1000),
      }),
    );
    logger.info({ ip, cookieName: this.cookieName }, '认证成功');
    res.json({ ok: true });
  };

  /** 当前活跃 session 数（监控用） */
  get sessionCount(): number {
    return this.sessions.size;
  }

  destroy(): void {
    this.rateLimiter.destroy();
    this.sessions.clear();
  }
}
