/**
 * 共享 sessions 存储（0.7.0）
 *
 * 设计目标（详见 ADR-006）：
 *  - **跨进程共享**：broker / 所有 worker 看到同一份 session 集合，避免按端口
 *    隔离 cookie；落地路径 `~/.atr/sessions.json`
 *  - **每次直读，不缓存**：所有 validateSession / getSession 都从盘上 load 一遍。
 *    多实例 + 同一磁盘文件场景下，进程内缓存=同步噩梦。本机磁盘读 8KB JSON
 *    用时 < 1ms（页缓存命中），与缓存收益不在一个量级。
 *  - **withFileLock 保护写**：create / delete / cleanup 都在锁内做 read-mutate-write。
 *  - **TTL 惰性失效**：load 出来再判过期，过期当未命中。cleanup 只是
 *    定期清理盘上残骸（可选）。
 *
 * 文件格式（schema v1）：
 * ```json
 * {
 *   "version": 1,
 *   "sessions": {
 *     "<sessionId>": { "createdAt": 1715200000000, "ip": "192.168.1.5",
 *                      "lastSeenAt": 1715200300000 }
 *   }
 * }
 * ```
 *
 * 与 0.6.x 的关系：
 *  - 不替换 AuthModule.sessions（内存 Map），先并存
 *  - 阶段 2 worker 改造时把 AuthModule 切换到本 store
 */

import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { homedir } from 'node:os';
import { ATR_DATA_DIR, ErrorCode } from 'auvezy-terminal-remote-shared';
import { atomicWriteJson } from '../utils/atomic-write.js';
import { withFileLock } from '../utils/file-lock.js';
import { generateSessionId } from '../auth/token-generator.js';
import { ConfigError } from '../errors.js';
import { logger } from '../logger/logger.js';

/** 单条 session 数据 */
export interface SessionEntry {
  /** 创建时间戳（ms） */
  createdAt: number;
  /** 创建时的客户端 IP（仅日志用，不做权限决策） */
  ip: string;
  /**
   * 最近一次被 validateSession 命中的时间戳（ms）。
   *
   * 暂不参与 TTL（TTL 仍按 createdAt 计算，避免活跃用户永不过期带来的
   * 安全风险）；保留是为了后续做"X 天未活跃下线"等策略时复用，避免再改
   * schema。
   */
  lastSeenAt: number;
}

/** 盘上完整结构 */
interface SessionsFile {
  version: 1;
  sessions: Record<string, SessionEntry>;
}

/** 当前 schema 版本；递增请同步 normalize 兼容逻辑 */
const SCHEMA_VERSION = 1;

/** 默认 sessions 文件名 */
const SESSIONS_FILENAME = 'sessions.json';

/** 默认锁名（与 sessions.json 同目录） */
const SESSIONS_LOCK_DIRNAME = '.sessions.lock';

/**
 * 默认 sessions 文件路径
 *
 * `~/.atr/sessions.json`，与 instances.json / vapid-keys.json 同目录。
 */
export function defaultSessionsPath(): string {
  return resolve(homedir(), ATR_DATA_DIR, SESSIONS_FILENAME);
}

export interface SessionsStoreOptions {
  /** sessions.json 路径；默认 `~/.atr/sessions.json` */
  path?: string;
  /** session TTL（ms），到期算未命中 */
  sessionTtlMs: number;
  /**
   * 锁目录路径；默认 `<path>/../.sessions.lock`。
   *
   * 显式可注入，便于测试在临时目录里跑。
   */
  lockDir?: string;
}

/**
 * 共享 sessions 存储
 *
 * 线程模型：实例方法不持长锁，每次读 = 直接读文件，每次写 = withFileLock 内
 * 做 RMW。**因此实例本身无可变状态**，可以多次 new、跨模块持有同一路径
 * 也安全。
 *
 * @example
 * const store = new SessionsStore({ sessionTtlMs: 24 * 3600 * 1000 });
 * await store.create('192.168.1.5');           // 返回新 sessionId
 * const ok = await store.validate(sessionId);  // 校验 + 续 lastSeenAt
 */
export class SessionsStore {
  private readonly path: string;
  private readonly lockDir: string;
  private readonly sessionTtlMs: number;

  constructor(opts: SessionsStoreOptions) {
    this.path = opts.path ?? defaultSessionsPath();
    this.lockDir = opts.lockDir ?? resolve(dirname(this.path), SESSIONS_LOCK_DIRNAME);
    this.sessionTtlMs = opts.sessionTtlMs;
  }

  // ──────────────── 公共 API ────────────────

  /**
   * 创建新 session
   *
   * @returns 新 sessionId
   */
  async create(ip: string): Promise<string> {
    const sid = generateSessionId();
    const now = Date.now();
    await withFileLock(this.lockDir, () => {
      const data = this.loadOrInit();
      data.sessions[sid] = { createdAt: now, ip, lastSeenAt: now };
      this.persist(data);
    });
    logger.info({ ip }, '已创建共享 session');
    return sid;
  }

  /**
   * 校验 session 是否有效，并刷新 lastSeenAt
   *
   * 过期 session 会被惰性删除（写盘）；不存在直接返 false 不写盘。
   * 写盘只为续 lastSeenAt，所以**只有命中时才进锁**——未命中纯读完成，
   * 高频 401 轮询不会争锁。
   */
  async validate(sessionId: string): Promise<boolean> {
    if (!sessionId) return false;
    const data = this.load();
    const entry = data.sessions[sessionId];
    if (!entry) return false;

    const now = Date.now();
    if (now - entry.createdAt > this.sessionTtlMs) {
      // 过期 → 惰性清理（进锁删，避免与并发 create 撞）
      await withFileLock(this.lockDir, () => {
        const fresh = this.loadOrInit();
        delete fresh.sessions[sessionId];
        this.persist(fresh);
      });
      return false;
    }

    // 命中 → 续 lastSeenAt（小幅写）
    if (now - entry.lastSeenAt > 1000) {
      // 1s 节流：避免每次请求都进锁写。session 活跃度精度到秒足够。
      await withFileLock(this.lockDir, () => {
        const fresh = this.loadOrInit();
        const e = fresh.sessions[sessionId];
        if (e) {
          e.lastSeenAt = now;
          this.persist(fresh);
        }
      });
    }
    return true;
  }

  /** 显式删除 session（用户登出 / 管理操作） */
  async remove(sessionId: string): Promise<void> {
    await withFileLock(this.lockDir, () => {
      const data = this.loadOrInit();
      if (data.sessions[sessionId]) {
        delete data.sessions[sessionId];
        this.persist(data);
      }
    });
  }

  /**
   * 清理所有过期 session
   *
   * 不在 hot path 调用——broker 启动 / 定时维护时跑一遍即可。
   * 返回清掉的条数。
   */
  async cleanup(now: number = Date.now()): Promise<number> {
    let removed = 0;
    await withFileLock(this.lockDir, () => {
      const data = this.loadOrInit();
      for (const [sid, entry] of Object.entries(data.sessions)) {
        if (now - entry.createdAt > this.sessionTtlMs) {
          delete data.sessions[sid];
          removed++;
        }
      }
      if (removed > 0) this.persist(data);
    });
    if (removed > 0) {
      logger.info({ removed }, 'sessions cleanup 清理过期会话');
    }
    return removed;
  }

  /** 当前活跃 session 数（盘上读，未过滤过期） */
  size(): number {
    return Object.keys(this.load().sessions).length;
  }

  /** 文件路径（供日志 / 测试使用） */
  get filePath(): string {
    return this.path;
  }

  // ──────────────── 私有：load / persist ────────────────

  /**
   * 读盘并 normalize，损坏 / 缺失返回空集合
   *
   * 任何"非 well-formed"情况（文件不存在、JSON 解析失败、字段缺失）都
   * 视作"空 sessions"，**不抛错**。理由：sessions 不是配置项，丢失 = 用户
   * 重新登录，比启动失败友好得多。
   */
  private load(): SessionsFile {
    if (!existsSync(this.path)) {
      return { version: SCHEMA_VERSION, sessions: {} };
    }
    let raw: string;
    try {
      raw = readFileSync(this.path, 'utf-8');
    } catch (err) {
      logger.warn({ path: this.path, err }, '读 sessions.json 失败，按空集合处理');
      return { version: SCHEMA_VERSION, sessions: {} };
    }
    return normalize(raw, this.path);
  }

  /** load 的别名，强调"在锁内 load 后会 mutate + persist" */
  private loadOrInit(): SessionsFile {
    return this.load();
  }

  /** 原子写 + 确保父目录存在 */
  private persist(data: SessionsFile): void {
    const dir = dirname(this.path);
    if (!existsSync(dir)) {
      try {
        mkdirSync(dir, { recursive: true, mode: 0o700 });
      } catch (err) {
        throw new ConfigError(
          ErrorCode.CONFIG_WRITE_FAILED,
          `创建 sessions 目录失败：${dir}`,
          500,
          err,
        );
      }
    }
    try {
      atomicWriteJson(this.path, data, 0o600);
    } catch (err) {
      throw new ConfigError(
        ErrorCode.CONFIG_WRITE_FAILED,
        `写 sessions.json 失败：${this.path}`,
        500,
        err,
      );
    }
  }
}

/**
 * 解析 + normalize 文件内容
 *
 * 损坏 / 不识别的 schema → 空集合 + 一行 warn；不抛错。
 * 导出供测试单独验证。
 */
export function normalize(raw: string, pathForLog?: string): SessionsFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    logger.warn({ path: pathForLog, err }, 'sessions.json JSON 解析失败，按空集合处理');
    return { version: SCHEMA_VERSION, sessions: {} };
  }
  if (!parsed || typeof parsed !== 'object') {
    return { version: SCHEMA_VERSION, sessions: {} };
  }
  const obj = parsed as Record<string, unknown>;
  if (obj['version'] !== SCHEMA_VERSION) {
    logger.warn(
      { path: pathForLog, version: obj['version'] },
      'sessions.json schema 版本不识别，按空集合处理',
    );
    return { version: SCHEMA_VERSION, sessions: {} };
  }
  const sessionsRaw = obj['sessions'];
  if (!sessionsRaw || typeof sessionsRaw !== 'object') {
    return { version: SCHEMA_VERSION, sessions: {} };
  }

  const sessions: Record<string, SessionEntry> = {};
  for (const [sid, val] of Object.entries(sessionsRaw as Record<string, unknown>)) {
    if (!val || typeof val !== 'object') continue;
    const v = val as Record<string, unknown>;
    const createdAt = typeof v['createdAt'] === 'number' ? v['createdAt'] : null;
    const ip = typeof v['ip'] === 'string' ? v['ip'] : null;
    const lastSeenAt = typeof v['lastSeenAt'] === 'number' ? v['lastSeenAt'] : createdAt;
    if (createdAt === null || ip === null) continue;
    sessions[sid] = { createdAt, ip, lastSeenAt: lastSeenAt ?? createdAt };
  }
  return { version: SCHEMA_VERSION, sessions };
}
