/**
 * WorkspaceIndex — wikilink 短名解析的工作目录索引。
 *
 * Lazy build:首次 ensureBuilt() 时全 walk cwd 收集 .md / .markdown,key 用
 * basename 去扩展名 + lowercase(对齐 Obsidian 大小写不敏感)。
 *
 * 增量维护:fs.watch(cwd, { recursive: true }) 监 rename/unlink/create;失败
 * (WSL/macOS 大目录已知不稳)时回退每 5 min 全扫。
 *
 * 解析算法:含 `/` → vault-root 相对 → 当前目录相对 fallback;短名 →
 * 全 vault 索引 → shortest-path 启发式(共同前缀目录段数最多 → 字节序最小)。
 *
 * 详见 docs/plans/obsidian-integration/adrs/003-wikilink-resolution-algorithm.md
 *
 * **不持久化**:索引完全活在内存,broker 重启重新 build(理由见 ADR-003 方案 E)。
 */

import { promises as fsp } from 'node:fs';
import { watch, type FSWatcher } from 'node:fs';
import { join, relative, dirname, basename, extname, sep } from 'node:path';
import { logger } from '../logger/logger.js';

export interface Anchor {
  kind: 'heading' | 'block';
  id: string;
}

export interface ResolveResult {
  /** 命中时:相对 cwd 的目标路径 */
  resolved?: string;
  /** ambiguous 时:全部候选(包含 resolved) */
  candidates?: string[];
  /** 无任何匹配 */
  broken?: true;
  /** 锚点信息(heading 或 block-id) */
  fragment?: Anchor;
}

const MD_EXTS = new Set(['.md', '.markdown']);
const REBUILD_INTERVAL_MS = 5 * 60 * 1000;
/** 索引最大「保鲜期」— 超过这个间隔的 resolve 调用会先触发一次 rebuild。
 *  Why:WSL2 mirrored 文件系统(/mnt/* / iCloud / SMB)上 fs.watch(recursive) 已知
 *  不稳;5 min poll 兜底太慢,用户加完 md 立即点 wikilink 看不到。30s 是「用户操作
 *  之间的典型间隔」— 用户来回切窗口、编辑、点链接,有 30s 间隔时刷新索引几乎无感。 */
const STALE_REBUILD_MS = 30 * 1000;

export class WorkspaceIndex {
  /** lowercased basename(去扩展名) → 相对 cwd 路径数组(已 sorted) */
  private byBasename = new Map<string, string[]>();
  private built = false;
  private buildPromise: Promise<void> | null = null;
  private watcher: FSWatcher | null = null;
  private rebuildTimer: NodeJS.Timeout | null = null;
  private rebuildScheduled = false;
  /** 上次 buildOnce() 完成时间;用于 staleness 检查决定是否要重 build */
  private lastBuiltAt = 0;

  constructor(private readonly cwd: string) {}

  async ensureBuilt(): Promise<void> {
    if (this.built) {
      // staleness check:fs.watch 在 WSL/mirrored FS 不稳,超过 STALE_REBUILD_MS
      // 的 resolve 调用强制重 build 一次。lazy 触发 — 用户来回操作有 30s 间隔时
      // 几乎无感,但能让"刚 touch 的 md 立刻能被解析"。
      const stale = Date.now() - this.lastBuiltAt > STALE_REBUILD_MS;
      if (!stale) return;
      // 进入 stale rebuild — 跟首次 build 一样走 buildPromise 防并发
    }
    if (this.buildPromise) {
      await this.buildPromise;
      return;
    }
    this.buildPromise = this.buildOnce();
    try {
      await this.buildPromise;
      this.built = true;
      this.lastBuiltAt = Date.now();
      this.startWatch();
    } finally {
      this.buildPromise = null;
    }
  }

  resolve(from: string, target: string): ResolveResult {
    const { pathPart, fragment } = splitFragment(target);
    if (pathPart.length === 0) {
      return fragment ? { broken: true, fragment } : { broken: true };
    }

    // 归一 from 为相对 cwd 路径(前端传过来的可能是绝对路径,如 PreviewTarget.path
    // 直接来自 list-dir 的绝对形态)
    const fromRel = this.normalizeFrom(from);

    if (pathPart.includes('/')) {
      // 路径形态:先 vault root 相对
      const fromVault = this.findByRelPath(pathPart);
      if (fromVault) return makeResult(fromVault, fragment);
      // 当前目录相对 fallback
      const fromCurrent = this.findByRelPath(join(dirname(fromRel), pathPart));
      if (fromCurrent) return makeResult(fromCurrent, fragment);
      return makeBroken(fragment);
    }

    // 短名形态
    const key = stripExt(pathPart).toLowerCase();
    const candidates = this.byBasename.get(key);
    if (!candidates || candidates.length === 0) return makeBroken(fragment);
    if (candidates.length === 1) return makeResult(candidates[0]!, fragment);

    // 多匹配:shortest-path 启发式(用归一后的 fromRel)
    const best = pickShortestPath(fromRel, candidates);
    return {
      resolved: best,
      candidates: [...candidates],
      ...(fragment ? { fragment } : {}),
    };
  }

  /**
   * 把 from 归一为相对 cwd 路径(POSIX `/` 分隔)。
   *
   * - 绝对路径(以 cwd 为前缀)→ 剥前缀
   * - 已是相对路径 → 原样(再做一次 split/join 防 Windows 反斜杠)
   * - 越过 cwd 的(`..`)→ 不在 vault 内,返回原 from(让 findByRelPath 自然 miss)
   */
  private normalizeFrom(from: string): string {
    const normalized = from.split(sep).join('/');
    const rootPosix = this.cwd.split(sep).join('/');
    if (normalized.startsWith(rootPosix + '/')) {
      return normalized.slice(rootPosix.length + 1);
    }
    if (normalized === rootPosix) return '';
    return normalized;
  }

  shutdown(): void {
    this.watcher?.close();
    this.watcher = null;
    if (this.rebuildTimer) clearInterval(this.rebuildTimer);
    this.rebuildTimer = null;
  }

  /** 同步触发一次 rebuild(单测 + scheduleRebuild 复用) */
  async rebuild(): Promise<void> {
    await this.buildOnce();
    this.lastBuiltAt = Date.now();
  }

  // ─── internals ──────────────────────────────────────────────

  private async buildOnce(): Promise<void> {
    const fresh = new Map<string, string[]>();
    await walk(this.cwd, this.cwd, (rel) => {
      const ext = extname(rel).toLowerCase();
      if (!MD_EXTS.has(ext)) return;
      const key = stripExt(basename(rel)).toLowerCase();
      const arr = fresh.get(key) ?? [];
      arr.push(rel);
      fresh.set(key, arr);
    });
    // 排序好的索引在 resolve() 内部不再排
    for (const arr of fresh.values()) arr.sort();
    this.byBasename = fresh;
  }

  private startWatch(): void {
    try {
      this.watcher = watch(this.cwd, { recursive: true }, () => {
        this.scheduleRebuild();
      });
    } catch (e) {
      logger.warn(
        { err: e, cwd: this.cwd },
        'WorkspaceIndex: fs.watch failed, falling back to 5min poll',
      );
    }
    // 周期兜底:即使 watch 失败 / 丢事件,5 min 一次全扫保底
    this.rebuildTimer = setInterval(() => {
      this.scheduleRebuild();
    }, REBUILD_INTERVAL_MS);
    this.rebuildTimer.unref?.();
  }

  private scheduleRebuild(): void {
    if (this.rebuildScheduled) return;
    this.rebuildScheduled = true;
    setTimeout(() => {
      this.rebuildScheduled = false;
      void this.buildOnce().catch((err) =>
        logger.warn({ err }, 'WorkspaceIndex rebuild failed'),
      );
    }, 500);
  }

  private findByRelPath(rel: string): string | null {
    const norm = rel.split(sep).join('/');
    // 显式带扩展名 / 默认 .md / 默认 .markdown 都试一遍
    for (const ext of ['', '.md', '.markdown']) {
      const candidate = norm + ext;
      const key = stripExt(basename(candidate)).toLowerCase();
      const arr = this.byBasename.get(key);
      if (arr?.includes(candidate)) return candidate;
    }
    return null;
  }
}

function makeResult(resolved: string, fragment?: Anchor): ResolveResult {
  return fragment ? { resolved, fragment } : { resolved };
}

function makeBroken(fragment?: Anchor): ResolveResult {
  return fragment ? { broken: true, fragment } : { broken: true };
}

/**
 * `Foo`         → { pathPart: 'Foo' }
 * `Foo#H2`      → { pathPart: 'Foo', fragment: { kind: 'heading', id: 'H2' } }
 * `Foo#^abc`    → { pathPart: 'Foo', fragment: { kind: 'block', id: 'abc' } }
 * `a/b#H`       → { pathPart: 'a/b', fragment: { kind: 'heading', id: 'H' } }
 * `Foo|alias`   → { pathPart: 'Foo' }(alias 防御性切除,前端 plugin 应已处理)
 */
function splitFragment(target: string): { pathPart: string; fragment?: Anchor } {
  const piped = target.split('|')[0]!;
  const hashIdx = piped.indexOf('#');
  if (hashIdx < 0) return { pathPart: piped.trim() };
  const pathPart = piped.slice(0, hashIdx).trim();
  const frag = piped.slice(hashIdx + 1).trim();
  if (frag.startsWith('^')) {
    return { pathPart, fragment: { kind: 'block', id: frag.slice(1) } };
  }
  return { pathPart, fragment: { kind: 'heading', id: frag } };
}

function stripExt(name: string): string {
  const ext = extname(name).toLowerCase();
  if (MD_EXTS.has(ext)) return name.slice(0, -ext.length);
  return name;
}

function pickShortestPath(from: string, candidates: string[]): string {
  return candidates
    .map((c) => ({ c, common: countCommonDirSegments(from, c) }))
    .sort((a, b) => {
      if (b.common !== a.common) return b.common - a.common;
      // 字节序 tie-break(用 < 而非 localeCompare,跨平台稳定。详见 ADR-003)
      return a.c < b.c ? -1 : a.c > b.c ? 1 : 0;
    })[0]!.c;
}

function countCommonDirSegments(a: string, b: string): number {
  const da = a.split('/').slice(0, -1);
  const db = b.split('/').slice(0, -1);
  let i = 0;
  while (i < da.length && i < db.length && da[i] === db[i]) i++;
  return i;
}

/**
 * 安全 walk:跟 symlink 时 realpath 校验未跳出 cwd。
 *
 * 排除目录规则(对齐"Obsidian 视角")**只**跳少数无意义噪声目录:
 *  - `.git` / `.obsidian` / `.trash` :版本控制 / Obsidian 自身缓存
 *  - `node_modules` :前端 lock 包,几万个 README.md 是噪声
 *
 * **不跳一般以 `.` 开头的目录**(如 `.claude/`, `.config/`),因为这些常包含
 *  用户实际想要 wikilink 的笔记/规则文档。这跟 file-browser 的"展示隐藏"逻辑
 *  不同 — file-browser 给前端打 hidden 标后由用户 toggle;索引则必须主动决定
 *  是否扫,默认应贴近 Obsidian 行为(尽量全扫,只屏蔽明显噪声)。
 */
const EXCLUDED_DIRS = new Set(['.git', '.obsidian', '.trash', 'node_modules']);

async function walk(
  root: string,
  cur: string,
  onFile: (rel: string) => void,
): Promise<void> {
  let ents;
  try {
    ents = await fsp.readdir(cur, { withFileTypes: true });
  } catch (err) {
    // 单个目录 readdir 失败(perm denied / 符号链接断 / WSL fs 偶发)不应整体失败,
    // 但要记 debug 让用户知道为什么少了某些文件
    logger.debug({ err, dir: cur }, 'WorkspaceIndex.walk: readdir failed (skipped)');
    return;
  }
  for (const e of ents) {
    if (EXCLUDED_DIRS.has(e.name)) continue;
    const full = join(cur, e.name);
    if (e.isSymbolicLink()) {
      try {
        const real = await fsp.realpath(full);
        const r = relative(root, real);
        if (r.startsWith('..') || r === '' || r.startsWith(sep + '..')) continue;
      } catch {
        continue;
      }
    }
    if (e.isDirectory() || (e.isSymbolicLink() && (await isDir(full)))) {
      await walk(root, full, onFile);
    } else if (e.isFile() || e.isSymbolicLink()) {
      const rel = relative(root, full).split(sep).join('/');
      onFile(rel);
    }
  }
}

async function isDir(p: string): Promise<boolean> {
  try {
    return (await fsp.stat(p)).isDirectory();
  } catch {
    return false;
  }
}
