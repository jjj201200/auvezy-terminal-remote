/**
 * /api/files/* 路由(broker 端)
 *
 * 端点:
 *   GET /api/files/list?instanceId=&path=
 *   GET /api/files/stat?instanceId=&path=
 *   GET /api/files/read?instanceId=&path=
 *   GET /api/files/raw?instanceId=&path=
 *   GET /api/files/search?instanceId=&q=...   (SSE)
 *
 * 鉴权:全部走 authModule.requireAuth。
 * 错误:统一 FileError → JSON;/raw 端点特殊用 X-ATR-Error header,不返 JSON
 * (浏览器 <img> 无法解析 JSON 错误体)。
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import { createReadStream } from 'node:fs';
import { lstat } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
  ErrorCode,
  FILE_RAW_MAX_BYTES,
  SEARCH_MAX_Q_LENGTH,
  isSearchMode,
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
import { HEADER_ATR_ERROR } from '../broker/forwarded-headers.js';
import {
  FILE_RATE_LIMIT_PER_MIN,
  SEARCH_RATE_LIMIT_PER_MIN,
} from '../constants.js';
import { resolveSafePath, type WorkdirPolicy } from '../files/path-resolver.js';
import { listDir } from '../files/list-dir.js';
import { detectMime } from '../files/mime-detect.js';
import { readTextFile } from '../files/read-file.js';
import { runSearch } from '../files/search-engine.js';
import { getFileKind } from '../files/file-kind.js';
import { WorkspaceIndex } from '../files/wikilink-resolver.js';


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

  // per-IP 限流:list/stat/read/raw/resolve-links 共享 fileLimiter,search 独立。
  // RateLimiter 内部 cleanupTimer 已 unref,无需显式 destroy 即可让 process 退出。
  const fileLimiter = new RateLimiter(FILE_RATE_LIMIT_PER_MIN);
  const searchLimiter = new RateLimiter(SEARCH_RATE_LIMIT_PER_MIN);

  /**
   * 实例级 WorkspaceIndex 缓存(wikilink 解析用)。
   * 首次访问时 lazy build,instance shutdown 时 registry 不通知 file-routes,
   * 索引会在内存中残留 — 接受这个泄漏(单 broker 进程内最多几十个 instance)。
   * 后续若需精细管理,在 instance-registry shutdown hook 里调 idx.shutdown()。
   */
  const wikilinkIndexes = new Map<string, WorkspaceIndex>();
  function getWikilinkIndex(instanceId: string, cwd: string): WorkspaceIndex {
    let idx = wikilinkIndexes.get(instanceId);
    if (!idx) {
      idx = new WorkspaceIndex(cwd);
      wikilinkIndexes.set(instanceId, idx);
    }
    return idx;
  }

  router.get('/files/list', authModule.requireAuth, requireRate(fileLimiter), wrap(async (req, res) => {
    const tStart = Date.now();
    const ctx = await resolveContext(req, registry, workdirPolicy);
    const target = resolveSafePath(ctx.cwd, asString(req.query.path), ctx.policy);
    const entries = await listDir(target);
    const parent = computeParent(ctx.cwd, target, ctx.policy);
    const payload: FileListResponse = {
      ok: true, cwd: ctx.cwd, path: target, parent, entries,
    };
    logger.info({
      action: 'list', instanceId: ctx.instanceId, path: target,
      ip: req.ip, elapsedMs: Date.now() - tStart,
    }, '/api/files audit');
    res.json(payload);
    // 预热 wikilink 索引(用户进了文件浏览器,大概率会点 .md → 解析 wikilink)。
    // fire-and-forget,首次 build 在用户浏览目录的几百毫秒里就跑起来,
    // 等他真点 wikilink 时索引已 ready,无白屏等待。
    getWikilinkIndex(ctx.instanceId, ctx.cwd).prefetch();
  }));

  router.get('/files/stat', authModule.requireAuth, requireRate(fileLimiter), wrap(async (req, res) => {
    const tStart = Date.now();
    const ctx = await resolveContext(req, registry, workdirPolicy);
    const target = resolveSafePath(ctx.cwd, asString(req.query.path), ctx.policy);
    const st = await lstat(target);
    const kind = getFileKind(st);
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
      lang: pickLang(m.lang, r.hasAnsi),
    };
    logger.info({
      action: 'read', instanceId: ctx.instanceId, path: target,
      ip: req.ip, elapsedMs: Date.now() - tStart,
      size: r.size, truncated: r.truncated,
    }, '/api/files audit');
    res.json(payload);
  }));

  // /raw 不走 wrap:错误时不返 JSON,用 X-ATR-Error header
  //
  // Range 支持:<video>/<audio> 元素加载时浏览器会先发不带 Range 的 GET 探总
  // 长度,再发 `Range: bytes=<start>-<end>` 拉片段以支持拖动进度条/seek。
  // 不带 Range → 200 + 全量 pipe;带合法 Range → 206 + 部分 pipe + Content-Range;
  // 不可满足 → 416。<img> 不发 Range,逻辑不受影响。
  //
  // size 上限策略 — `FILE_RAW_MAX_BYTES` 只对 **图片 / 未知二进制** 生效,
  // 视频/音频不查上限:浏览器 <video>/<audio> 通过 Range 分片拉,不会把整个
  // 文件 buffer 进客户端;一集 1080p 动画动辄几百 MB,套硬上限只会让正常
  // 媒体预览失败。同时也限制了图片仍走整文件 GET → 大图保护内存。
  router.get('/files/raw', authModule.requireAuth, requireRate(fileLimiter), async (req, res) => {
    const tStart = Date.now();
    let auditCtx: RouteContext | undefined;
    let auditPath: string | undefined;
    try {
      auditCtx = await resolveContext(req, registry, workdirPolicy);
      auditPath = resolveSafePath(auditCtx.cwd, asString(req.query.path), auditCtx.policy);
      const st = await lstat(auditPath);
      if (!st.isFile()) throw new FileError(ErrorCode.FILE_TYPE_FORBID, '', 409);
      const { mime, previewable } = detectMime(auditPath);
      // 视频/音频跳过 size 上限(Range 分片自带流控,不会一次性灌满内存);
      // 图片 / 未知二进制 / 文本仍受 FILE_RAW_MAX_BYTES 保护
      const exemptFromSizeLimit = previewable === 'video' || previewable === 'audio';
      if (!exemptFromSizeLimit && st.size > FILE_RAW_MAX_BYTES) {
        throw new FileError(ErrorCode.FILE_TOO_LARGE, '', 413);
      }
      // weak ETag = `<size>-<mtimeMs ⌊⌋>`:size+mtime 区分内容版本,够稳;
      // weak(W/)因为 mtime 在某些 FS 精度低于浏览器期望的字节级强校验。
      // 用 ⌊mtimeMs⌋ 而非 toFixed:跨平台精度差异在整数毫秒以下不该让 ETag 抖
      const etag = `W/"${st.size}-${Math.floor(st.mtimeMs)}"`;
      res.setHeader('Content-Type', mime);
      // LAN 内容用户私有(token 鉴权);max-age=3600 让浏览器二次打开秒回 304。
      // 媒体文件用户切回再开很常见(关 sheet → 想想 → 再开),缓存命中省大流量
      res.setHeader('Cache-Control', 'private, max-age=3600');
      res.setHeader('ETag', etag);
      res.setHeader('Accept-Ranges', 'bytes');

      // 304 优先:If-None-Match 命中直接返,不走 Range/全量 pipe 分支。
      // 即使带 Range 也优先 304 — 浏览器拿到 304 后用 disk cache 满足 Range
      const ifNoneMatch = req.headers['if-none-match'];
      if (typeof ifNoneMatch === 'string' && etagMatches(ifNoneMatch, etag)) {
        res.status(304).end();
        logger.info({
          action: 'raw', instanceId: auditCtx.instanceId, path: auditPath,
          ip: req.ip, elapsedMs: Date.now() - tStart, size: st.size, status: 304,
        }, '/api/files audit (not modified)');
        return;
      }

      const rangeHeader = req.headers.range;
      const range = parseRangeHeader(rangeHeader, st.size);
      if (range === 'invalid') {
        // 416 必须带 Content-Range: bytes */<size> 告知合法范围
        res.setHeader('Content-Range', `bytes */${st.size}`);
        res.status(416).end();
        logger.info({
          action: 'raw', instanceId: auditCtx.instanceId, path: auditPath,
          ip: req.ip, elapsedMs: Date.now() - tStart, size: st.size,
          rangeHeader, status: 416,
        }, '/api/files audit (range not satisfiable)');
        return;
      }
      if (range) {
        const len = range.end - range.start + 1;
        res.status(206);
        res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${st.size}`);
        res.setHeader('Content-Length', String(len));
        logger.info({
          action: 'raw', instanceId: auditCtx.instanceId, path: auditPath,
          ip: req.ip, elapsedMs: Date.now() - tStart, size: st.size,
          rangeStart: range.start, rangeEnd: range.end, partialLen: len,
        }, '/api/files audit (partial)');
        createReadStream(auditPath, { start: range.start, end: range.end }).pipe(res);
        return;
      }

      res.setHeader('Content-Length', String(st.size));
      logger.info({
        action: 'raw', instanceId: auditCtx.instanceId, path: auditPath,
        ip: req.ip, elapsedMs: Date.now() - tStart, size: st.size,
      }, '/api/files audit');
      createReadStream(auditPath).pipe(res);
    } catch (err) {
      const code = err instanceof AppError ? err.code : ErrorCode.INTERNAL_ERROR;
      const status = err instanceof AppError ? err.httpStatus : 500;
      res.setHeader(HEADER_ATR_ERROR, String(code));
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
    if (!isSearchMode(modeRaw)) {
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

  // ──────────────── POST /api/files/resolve-links ────────────────
  // wikilink 批量解析 — 输入 { instanceId, from, targets[] } → 输出每个 target 的解析结果。
  // Why POST(非幂等检索):targets 数组可能很长不适合 query string;且首次调用可能
  // 触发 WorkspaceIndex lazy build(有副作用)。详见 design.md §7.1。
  router.post(
    '/files/resolve-links',
    authModule.requireAuth,
    requireRate(fileLimiter),
    wrap(async (req, res) => {
      const tStart = Date.now();
      const body = req.body as {
        instanceId?: unknown;
        from?: unknown;
        targets?: unknown;
      };
      if (
        typeof body.instanceId !== 'string' ||
        body.instanceId.length === 0 ||
        typeof body.from !== 'string' ||
        !Array.isArray(body.targets)
      ) {
        throw new AppError(
          ErrorCode.BAD_REQUEST,
          'body must be { instanceId: string, from: string, targets: string[] }',
        );
      }
      // 数量上限:一个 markdown 文档常含 < 50 wikilink;200 是安全冗余
      if (body.targets.length > 200) {
        throw new AppError(ErrorCode.BAD_REQUEST, 'too many targets (max 200)');
      }
      for (const t of body.targets) {
        if (typeof t !== 'string') {
          throw new AppError(ErrorCode.BAD_REQUEST, 'target must be string');
        }
      }
      const targets = body.targets as string[];

      // 复用 resolveContext —— 把 instanceId 注入 query 通过它一致校验
      const reqWithQuery = Object.assign(Object.create(Object.getPrototypeOf(req) as object), req, {
        query: { ...req.query, instanceId: body.instanceId },
      }) as Request;
      const ctx = await resolveContext(reqWithQuery, registry, workdirPolicy);

      // from 安全检查 — 防伪造 ../.. 路径用 cwd 之外的位置定位
      resolveSafePath(ctx.cwd, body.from, ctx.policy);

      const idx = getWikilinkIndex(ctx.instanceId, ctx.cwd);
      await idx.ensureBuilt();

      const results = targets.map((target) => ({
        target,
        ...idx.resolve(body.from as string, target),
      }));

      res.json({ ok: true, results });

      logger.info(
        {
          action: 'resolve-links',
          instanceId: ctx.instanceId,
          from: body.from,
          targetsCount: targets.length,
          ip: req.ip,
          elapsedMs: Date.now() - tStart,
        },
        '/api/files audit',
      );
    }),
  );

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

/**
 * If-None-Match 头 vs 服务端 ETag 比对(RFC 7232 §3.2):
 *  - `*` → 永远匹配
 *  - 逗号分隔的多 ETag,任一匹配即可
 *  - weak 比较(W/ 前缀剥掉再比):因为我们生成的是 weak ETag
 *
 * 不实现 strong 比较 — 我们只回 weak ETag,客户端不应基于强校验决策。
 */
function etagMatches(ifNoneMatch: string, etag: string): boolean {
  const trimmed = ifNoneMatch.trim();
  if (trimmed === '*') return true;
  const stripWeak = (e: string): string =>
    e.trim().replace(/^W\//, '');
  const target = stripWeak(etag);
  return trimmed.split(',').some((cand) => stripWeak(cand) === target);
}

/**
 * 解析 HTTP Range 头(只接受 `bytes=` 单段),返回:
 *   - 字节区间 `{start, end}`(均含两端,符合 RFC 7233)
 *   - `null` 表示无 Range 头(走 200 全量分支)
 *   - `'invalid'` 表示语法/越界不可满足(走 416)
 *
 * 仅支持单段范围 —— 多段 `bytes=0-100,200-300` 需要 multipart/byteranges 响应,
 * <video>/<audio> 实际只会发单段,不实现这层复杂性。
 *
 * 三种合法形式:
 *   - `bytes=START-END`     完整区间
 *   - `bytes=START-`        从 START 到文件末尾
 *   - `bytes=-SUFFIXLEN`    末尾 SUFFIXLEN 字节(SUFFIXLEN > 0)
 */
function parseRangeHeader(
  header: string | undefined,
  size: number,
): { start: number; end: number } | null | 'invalid' {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return 'invalid';
  const startStr = m[1] ?? '';
  const endStr = m[2] ?? '';
  if (startStr === '' && endStr === '') return 'invalid';

  // 空文件:任意范围都不满足
  if (size === 0) return 'invalid';

  let start: number;
  let end: number;
  if (startStr === '') {
    // suffix:bytes=-N → 末尾 N 字节
    const suffix = Number.parseInt(endStr, 10);
    if (!Number.isFinite(suffix) || suffix <= 0) return 'invalid';
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number.parseInt(startStr, 10);
    if (!Number.isFinite(start) || start < 0) return 'invalid';
    if (endStr === '') {
      end = size - 1;
    } else {
      end = Number.parseInt(endStr, 10);
      if (!Number.isFinite(end) || end < start) return 'invalid';
      // 末端超尾按 RFC 7233 截到 size-1
      if (end >= size) end = size - 1;
    }
  }
  if (start >= size) return 'invalid';
  return { start, end };
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
 * 文件 lang 选择:扩展名推断 + ANSI 内容启发式。
 *
 * Why 限制集合:.ts / .py / .md 等源码 / 标记语言里可能恰好含 ESC '['
 * 字符串字面量,不该被强制改成 ansi。仅在"按扩展名也判不出语言"(txt)
 * 或"本就是日志/纯文本"(log)时让 ansi 覆盖。
 */
function pickLang(baseLang: string, hasAnsi: boolean): string {
  if (hasAnsi && (baseLang === 'txt' || baseLang === 'log')) {
    return 'ansi';
  }
  return baseLang;
}

/**
 * 计算上级目录(用作 list 响应的 parent 字段)。
 *
 * 必须传实例 cwd:resolveSafePath 内部把 cwd 当"硬墙",越过 cwd 之上的
 * 父目录会被拒,返 null 让前端禁用"上级"按钮。
 *
 * 当 current === cwd 时,上级就是 cwd 之上 → 必返 null(根目录不可越界)。
 */
function computeParent(cwd: string, current: string, policy: WorkdirPolicy): string | null {
  if (current === cwd) return null;
  const parentPath = dirname(current);
  if (parentPath === current) return null;
  try {
    // 用 cwd 做硬墙;resolveSafePath 会自动拒 cwd 之外的 parent
    resolveSafePath(cwd, parentPath, policy);
    return parentPath;
  } catch {
    return null;
  }
}
