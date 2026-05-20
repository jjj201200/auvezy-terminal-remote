/**
 * /api/files/* 路由(broker 端)
 *
 * 端点(MVP 不含 search,见阶段 4):
 *   GET /api/files/list?instanceId=&path=
 *   GET /api/files/stat?instanceId=&path=
 *   GET /api/files/read?instanceId=&path=
 *   GET /api/files/raw?instanceId=&path=
 *
 * 鉴权:全部走 authModule.requireAuth(与现有 broker API 一致)。
 * 错误:统一 FileError → JSON;/raw 端点特殊用 X-ATR-Error header,不返 JSON
 * (因为浏览器 <img> 不会解析 JSON 错误体)。
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import { createReadStream } from 'node:fs';
import { lstat } from 'node:fs/promises';
import {
  ErrorCode,
  FILE_RAW_MAX_BYTES,
  SEARCH_MAX_Q_LENGTH,
  type FileListResponse,
  type FileReadResponse,
  type FileStatResponse,
} from 'auvezy-terminal-remote-shared';
import type { InstanceRegistryManager } from '../registry/instance-registry.js';
import type { AuthModule } from '../auth/auth-middleware.js';
import type { WorkdirPolicySnapshot } from './workdir-policy-routes.js';
import { FileError, AppError } from '../errors.js';
import { logger } from '../logger/logger.js';
import { RateLimiter } from '../auth/rate-limiter.js';
import { resolveSafePath, type WorkdirPolicy } from '../files/path-resolver.js';
import { listDir } from '../files/list-dir.js';
import { detectMime, detectLang } from '../files/mime-detect.js';
import { readTextFile } from '../files/read-file.js';
import { runSearch } from '../files/search-engine.js';

/** /api/files/* 共享速率限制(per-IP 每分钟) */
const FILE_RATE_LIMIT_PER_MIN = 120;
/** /api/files/search 独立速率限制(per-IP 每分钟) */
const SEARCH_RATE_LIMIT_PER_MIN = 20;

export interface FileRoutesOptions {
  authModule: AuthModule;
  registry: InstanceRegistryManager;
  /** 工厂:返回当前生效的完整 policy(含 deny;允许 file-routes 内部复用) */
  workdirPolicy: () => WorkdirPolicySnapshot;
}

interface RouteContext {
  cwd: string;
  policy: WorkdirPolicy;
  instanceId: string;
}

export function createFileRoutes(opts: FileRoutesOptions): Router {
  const router = Router();
  const { authModule, registry, workdirPolicy } = opts;

  // per-IP 限流:list/stat/read/raw 共享,search 独立(给后续阶段 4 用)
  // RateLimiter 内部 cleanupTimer 已 unref,无需显式 destroy 即可让 process 退出
  const fileLimiter = new RateLimiter(FILE_RATE_LIMIT_PER_MIN);
  const searchLimiter = new RateLimiter(SEARCH_RATE_LIMIT_PER_MIN);

  router.get('/files/list', authModule.requireAuth, requireRate(fileLimiter), wrap(async (req, res) => {
    const tStart = Date.now();
    const ctx = await resolveContext(req, registry, workdirPolicy);
    const target = resolveSafePath(ctx.cwd, asString(req.query.path), ctx.policy);
    const entries = await listDir(target);
    const parent = computeParent(target, ctx.policy);
    const payload: FileListResponse = {
      ok: true, cwd: ctx.cwd, path: target, parent, entries,
    };
    logger.info({
      action: 'list', instanceId: ctx.instanceId, path: target,
      ip: req.ip, elapsedMs: Date.now() - tStart,
    }, '/api/files audit');
    res.json(payload);
  }));

  router.get('/files/stat', authModule.requireAuth, requireRate(fileLimiter), wrap(async (req, res) => {
    const tStart = Date.now();
    const ctx = await resolveContext(req, registry, workdirPolicy);
    const target = resolveSafePath(ctx.cwd, asString(req.query.path), ctx.policy);
    const st = await lstat(target);
    const kind: FileStatResponse['kind'] = st.isSymbolicLink() ? 'symlink'
      : st.isDirectory() ? 'dir'
      : st.isFile() ? 'file' : 'other';
    const payload: FileStatResponse = {
      ok: true, path: target, kind,
      size: kind === 'dir' ? 0 : st.size,
      mtimeMs: st.mtimeMs,
    };
    if (kind === 'file') {
      const m = detectMime(target);
      payload.mime = m.mime;
      payload.previewable = m.previewable;
    }
    logger.info({
      action: 'stat', instanceId: ctx.instanceId, path: target,
      ip: req.ip, elapsedMs: Date.now() - tStart,
    }, '/api/files audit');
    res.json(payload);
  }));

  router.get('/files/read', authModule.requireAuth, requireRate(fileLimiter), wrap(async (req, res) => {
    const tStart = Date.now();
    const ctx = await resolveContext(req, registry, workdirPolicy);
    const target = resolveSafePath(ctx.cwd, asString(req.query.path), ctx.policy);
    const st = await lstat(target);
    if (!st.isFile()) {
      throw new FileError(ErrorCode.FILE_TYPE_FORBID, 'not a regular file', 409);
    }
    const r = await readTextFile(target);
    const m = detectMime(target);
    const payload: FileReadResponse = {
      ok: true, path: target, mime: m.mime,
      content: r.content, truncated: r.truncated, size: r.size,
      lang: detectLang(target),
    };
    logger.info({
      action: 'read', instanceId: ctx.instanceId, path: target,
      ip: req.ip, elapsedMs: Date.now() - tStart,
      size: r.size, truncated: r.truncated,
    }, '/api/files audit');
    res.json(payload);
  }));

  // /raw 不走 wrap:错误时不返 JSON,用 X-ATR-Error header
  router.get('/files/raw', authModule.requireAuth, requireRate(fileLimiter), async (req, res) => {
    const tStart = Date.now();
    let auditCtx: RouteContext | undefined;
    let auditPath: string | undefined;
    try {
      auditCtx = await resolveContext(req, registry, workdirPolicy);
      auditPath = resolveSafePath(auditCtx.cwd, asString(req.query.path), auditCtx.policy);
      const st = await lstat(auditPath);
      if (!st.isFile()) throw new FileError(ErrorCode.FILE_TYPE_FORBID, '', 409);
      if (st.size > FILE_RAW_MAX_BYTES) {
        throw new FileError(ErrorCode.FILE_TOO_LARGE, '', 413);
      }
      const { mime } = detectMime(auditPath);
      res.setHeader('Content-Type', mime);
      res.setHeader('Cache-Control', 'private, max-age=0');
      res.setHeader('Content-Length', String(st.size));
      logger.info({
        action: 'raw', instanceId: auditCtx.instanceId, path: auditPath,
        ip: req.ip, elapsedMs: Date.now() - tStart, size: st.size,
      }, '/api/files audit');
      createReadStream(auditPath).pipe(res);
    } catch (err) {
      const code = err instanceof AppError ? err.code : ErrorCode.INTERNAL_ERROR;
      const status = err instanceof AppError ? err.httpStatus : 500;
      res.setHeader('X-ATR-Error', String(code));
      logger.info({
        action: 'raw', instanceId: auditCtx?.instanceId, path: auditPath,
        ip: req.ip, elapsedMs: Date.now() - tStart, code, status,
      }, '/api/files audit (error)');
      res.status(status).end();
    }
  });

  // ──────────────── /api/files/search SSE ────────────────
  router.get('/files/search', authModule.requireAuth, requireRate(searchLimiter), async (req, res) => {
    const tStart = Date.now();

    // 参数校验
    const q = asString(req.query.q);
    if (!q || q.length === 0 || q.length > SEARCH_MAX_Q_LENGTH) {
      res.status(400).json({
        error: { code: ErrorCode.BAD_REQUEST, message: 'q is required (1..200)' },
      });
      return;
    }
    const modeRaw = asString(req.query.mode) ?? 'name';
    if (modeRaw !== 'name' && modeRaw !== 'content' && modeRaw !== 'both') {
      res.status(400).json({
        error: { code: ErrorCode.BAD_REQUEST, message: 'invalid mode' },
      });
      return;
    }

    // 解 ctx
    let ctx;
    try {
      ctx = await resolveContext(req, registry, workdirPolicy);
    } catch (err) {
      if (err instanceof AppError) {
        res.status(err.httpStatus).json({ error: { code: err.code, message: err.message } });
      } else {
        res.status(500).end();
      }
      return;
    }

    // 解 scope(默认 cwd;给的话必须是目录)
    let scopePath: string;
    try {
      scopePath = resolveSafePath(ctx.cwd, asString(req.query.scope), ctx.policy);
      const st = await lstat(scopePath);
      if (!st.isDirectory()) {
        throw new FileError(ErrorCode.BAD_REQUEST, 'scope must be a directory', 400);
      }
    } catch (err) {
      if (err instanceof AppError) {
        res.status(err.httpStatus).json({ error: { code: err.code, message: err.message } });
      } else {
        res.status(500).end();
      }
      return;
    }

    // SSE 头
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const ac = new AbortController();
    req.on('close', () => ac.abort());

    try {
      const summary = await runSearch({
        scope: scopePath,
        q,
        mode: modeRaw,
        caseSensitive: asString(req.query.caseSensitive) === '1',
        regex: asString(req.query.regex) === '1',
        policy: ctx.policy,
        cancelSignal: ac.signal,
        emit: (hit) => {
          res.write(`event: match\ndata: ${JSON.stringify(hit)}\n\n`);
        },
      });
      res.write(`event: done\ndata: ${JSON.stringify(summary)}\n\n`);
      logger.info({
        action: 'search', instanceId: ctx.instanceId, path: scopePath,
        ip: req.ip, elapsedMs: Date.now() - tStart,
        scanned: summary.scanned, truncated: summary.truncated,
      }, '/api/files audit');
    } catch (err) {
      const code = err instanceof AppError ? err.code : ErrorCode.INTERNAL_ERROR;
      const message = err instanceof Error ? err.message : String(err);
      res.write(`event: error\ndata: ${JSON.stringify({ code, message })}\n\n`);
      logger.warn({
        action: 'search', instanceId: ctx.instanceId, path: scopePath,
        ip: req.ip, elapsedMs: Date.now() - tStart, code,
      }, '/api/files audit (error)');
    } finally {
      res.end();
    }
  });

  return router;
}

// ──────────────── 内部辅助 ────────────────

type AsyncHandler = (req: Request, res: Response) => Promise<void>;

/** Express handler 包装:catch AppError 转 JSON,其它 500 */
function wrap(h: AsyncHandler) {
  return async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    try { await h(req, res); }
    catch (err) {
      if (err instanceof AppError) {
        res.status(err.httpStatus).json({
          error: { code: err.code, message: err.message },
        });
        return;
      }
      logger.error({ err }, '/api/files unexpected error');
      res.status(500).json({
        error: { code: ErrorCode.INTERNAL_ERROR, message: 'internal error' },
      });
    }
  };
}

function asString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

/** per-IP 限流 middleware:超限 → 429 + AUTH_RATE_LIMITED */
function requireRate(limiter: RateLimiter) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const ip = req.ip ?? 'unknown';
    if (!limiter.attempt(ip)) {
      res.status(429).json({
        error: { code: ErrorCode.AUTH_RATE_LIMITED, message: 'rate limited' },
      });
      return;
    }
    next();
  };
}

async function resolveContext(
  req: Request,
  registry: InstanceRegistryManager,
  workdirPolicy: () => WorkdirPolicySnapshot,
): Promise<RouteContext> {
  const instanceId = req.query.instanceId;
  if (typeof instanceId !== 'string' || instanceId.length === 0) {
    throw new FileError(ErrorCode.BAD_REQUEST, 'instanceId is required', 400);
  }
  const all = await registry.list();
  const inst = all.find((i) => i.instanceId === instanceId);
  if (!inst) {
    throw new FileError(
      ErrorCode.INSTANCE_NOT_FOUND, `instance not found: ${instanceId}`, 404,
    );
  }
  const snap = workdirPolicy();
  return {
    cwd: inst.cwd,
    policy: { allow: snap.allow, deny: snap.deny },
    instanceId,
  };
}

/**
 * 计算上级目录(用作 list 响应的 parent 字段)。
 * 上级仍需过 policy 闸,不通过则返 null(前端禁用"上级"按钮)。
 */
function computeParent(current: string, policy: WorkdirPolicy): string | null {
  // Windows / Unix 通用:用 path.dirname 等价的字符串切;current 已是 realpath 后的绝对路径
  const lastSep = Math.max(current.lastIndexOf('/'), current.lastIndexOf('\\'));
  if (lastSep <= 0) return null;
  const parentPath = current.slice(0, lastSep) || '/';
  if (parentPath === current) return null;
  try {
    resolveSafePath(parentPath, '.', policy);
    return parentPath;
  } catch {
    return null;
  }
}
