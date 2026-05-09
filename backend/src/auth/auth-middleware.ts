/**
 * AuthModule (0.7.0)
 *
 * Token + Session Cookie 认证模块。0.7.0 起 session 默认走 SessionsStore（共享文件），
 * cookie 名统一为 `session_id`（不再带端口后缀）。
 *
 * 流程：
 *  1. 客户端 POST /api/auth { token } → AuthModule.handleAuth
 *  2. 限流检查 → timingSafeEqual 比对 → 通过则在 SessionsStore 创建 + Set-Cookie
 *  3. 后续请求带 Cookie → requireAuth 中间件 await store.validate
 *  4. WS upgrade 阶段：authenticate 是 async，handler 内 await
 *
 * 与 0.6.x 的差异：
 *  - **API async 化**：createSession / validateSession / requireAuth 都返回 Promise
 *  - **cookie 名默认 `session_id`**：单 PWA 单 origin，多 worker 共用 cookie（ADR-005/006）
 *  - **SessionsStore 注入**：构造时必须传一份 SessionsStore；测试时可注入 InMemorySessionsStore（见下）
 *  - 不再用进程内 Map：避免 broker / 多 worker session 不一致
 *
 * 与 ws-authenticate 的契约：
 *  - 旧 cookie 名（`session_id_p<port>`）兼容读取一段时间，避免 0.6.x → 0.7.0 升级时
 *    用户已签的 cookie 立刻全失效；写入只用新名 `session_id`
 */

import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { timingSafeEqual } from 'node:crypto';
import * as cookie from 'cookie';
import { ErrorCode } from 'auvezy-terminal-remote-shared';
import { RateLimiter } from './rate-limiter.js';
import { logger } from '../logger/logger.js';
import { AuthError } from '../errors.js';
import type { SessionsStore } from '../sessions/sessions-store.js';

/** 0.7.0 起统一 cookie 名 */
export const DEFAULT_SESSION_COOKIE_NAME = 'session_id';

export interface AuthModuleOptions {
  /** 当前实例使用的 token */
  token: string;
  /** Session 有效期（毫秒） */
  sessionTtlMs: number;
  /** 限流：每 IP 每分钟最大尝试次数 */
  rateLimitPerMinute: number;
  /**
   * Cookie 名；默认 `session_id`。多实例下统一一个名（ADR-006）。
   *
   * 仅当外部明确要测旧端口绑定行为时才覆盖。
   */
  cookieName?: string;
  /**
   * 兼容读取的旧 cookie 名（如 `session_id_p3000`）。
   *
   * 升级路径：0.7.0 worker 仍能识别 0.6.x 时期签发的端口后缀 cookie，避免用户
   * 升级后第一次访问被强制要求重新登录。**只读取**，不写入。
   *
   * 不传则只识别 `cookieName`。
   */
  legacyCookieNames?: readonly string[];
  /** SessionsStore（必填） */
  sessions: SessionsStore;
}

/**
 * 生成 0.6.x 端口绑定的 cookie 名
 *
 * 0.7.0 起新代码不再使用此函数；保留是为了：
 *  - legacyCookieNames 构造（升级兼容）
 *  - 0.6.x 老测试 fixture 不强制改全套
 */
export function createSessionCookieName(port: number): string {
  return `session_id_p${port}`;
}

export class AuthModule {
  private readonly token: string;
  private readonly sessionTtlMs: number;
  private readonly cookieName: string;
  private readonly legacyCookieNames: readonly string[];
  private readonly sessions: SessionsStore;
  private readonly rateLimiter: RateLimiter;

  constructor(opts: AuthModuleOptions) {
    this.token = opts.token;
    this.sessionTtlMs = opts.sessionTtlMs;
    this.cookieName = opts.cookieName ?? DEFAULT_SESSION_COOKIE_NAME;
    this.legacyCookieNames = opts.legacyCookieNames ?? [];
    this.sessions = opts.sessions;
    this.rateLimiter = new RateLimiter(opts.rateLimitPerMinute);
  }

  // ──────────────── 公共 API ────────────────

  /**
   * 时序安全的 token 比对
   *
   * 先比长度（不同直接 false）；相同则用 timingSafeEqual 恒定时间比较。
   */
  verifyToken(candidate: string): boolean {
    const a = Buffer.from(this.token, 'utf-8');
    const b = Buffer.from(candidate, 'utf-8');
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }

  /** 在共享 store 中创建 session 并返回 sessionId */
  async createSession(ip: string): Promise<string> {
    const sid = await this.sessions.create(ip);
    logger.info({ ip }, '已创建 session');
    return sid;
  }

  /** 校验 session（共享 store；TTL 由 store 内部维护） */
  async validateSession(sessionId: string): Promise<boolean> {
    if (!sessionId) return false;
    return this.sessions.validate(sessionId);
  }

  /**
   * 从 Express Request 取 sessionId
   *
   * 优先匹配新 cookie 名；找不到时回退到 legacyCookieNames 顺序匹配。
   */
  getSessionFromRequest(req: Request): string | null {
    return this.getSessionFromCookieHeader(req.headers.cookie ?? '');
  }

  /** 从原始 cookie header 字符串取 sessionId（WS upgrade 用） */
  getSessionFromCookieHeader(cookieHeader: string): string | null {
    const cookies = cookie.parse(cookieHeader);
    const newCookie = cookies[this.cookieName];
    if (newCookie) return newCookie;
    for (const name of this.legacyCookieNames) {
      const v = cookies[name];
      if (v) return v;
    }
    return null;
  }

  /** 当前 cookie 名（供日志诊断 / Set-Cookie 用） */
  getCookieName(): string {
    return this.cookieName;
  }

  /**
   * Express 中间件：要求请求带有效 Session
   *
   * **async 中间件**：返回 Promise；Express 5 会自动处理 reject 走错误处理，
   * Express 4 需要 `next(err)` 显式抛——这里不主动抛，预期失败统一 401。
   */
  readonly requireAuth: RequestHandler = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    const sid = this.getSessionFromRequest(req);
    const ok = sid ? await this.validateSession(sid) : false;
    if (!ok) {
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
  readonly handleAuth = async (req: Request, res: Response): Promise<void> => {
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
      logger.info({ ip }, '认证失败：token 无效');
      res.status(err.httpStatus).json({ error: err.toPayload() });
      return;
    }

    const sid = await this.createSession(ip);
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

  destroy(): void {
    this.rateLimiter.destroy();
  }
}
