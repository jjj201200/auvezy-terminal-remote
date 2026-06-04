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
  /**
   * vault 探测结果缓存。null = 还没探,true/false = 已知。
   * non-vault 用户每次 /files/list 都触发 prefetch,不缓存就会每次 lstat。
   * vault 状态运行时几乎不变(用户开 Obsidian 时 .obsidian/ 才出现),缓存到
   * 实例生命周期足够。
   */
  private vaultChecked: boolean | null = null;

  constructor(private readonly cwd: string) {}

  /**
   * 触发索引就绪。
   *
   * 关键设计:**不阻塞用户请求等 rebuild**。
   *  - 首次:必须 await(没数据可用)
   *  - 已 built 但 stale:**fire-and-forget 后台 rebuild**,立即用旧索引响应。
   *    用户拿到老数据 + 几百毫秒内 background 完成 → 下次请求自动新数据。
   *
   * Why:WSL DrvFs walk 5+ 秒,prod WSL 加用户大 vault 可能 10+ 秒,
   * 不能让用户每 30s 卡一次 wikilink 解析。Obsidian 自身也是后台维护索引,
   * 用户从不感知 vault rescan。
   */
  async ensureBuilt(): Promise<void> {
    if (this.built) {
      const stale = Date.now() - this.lastBuiltAt > STALE_REBUILD_MS;
      if (stale && !this.buildPromise) {
        // 后台 rebuild,**不 await** —— 当前请求用旧索引立即响应
        this.buildPromise = this.buildOnce()
          .then(() => {
            this.lastBuiltAt = Date.now();
          })
          .catch((err) => {
            logger.warn({ err }, 'WorkspaceIndex background rebuild failed');
          })
          .finally(() => {
            this.buildPromise = null;
          });
      }
      return;
    }
    // 首次:必须 await
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

  /**
   * 后台预热:在用户主动 resolve 之前异步触发首次 build。
   * 调用方 fire-and-forget。已 built 或正在 build 时 no-op。
   *
   * 推荐挂在 /files/list 第一次被调时(用户刚打开文件浏览器,索引提前热好)。
   *
   * **vault gate**:预热只对 Obsidian vault 触发。判定靠 `<cwd>/.obsidian/`
   * 是否存在。其它仓库(observer、monorepo、Go project 等)首次 list 不会触发
   * 整仓 walk —— 这是非 vault 用户进 files browser 直接卡死的根因(原本即便
   * 没 .obsidian 也会 prefetch + 全 walk,大仓库会 fd 风暴或耗几十秒)。
   *
   * 注意:`ensureBuilt()` 不受此 gate 影响 —— 若用户显式发 wikilink resolve
   * 请求(/files/resolve-links),无论是不是 vault 都会按需 build。这层只屏蔽
   * 后台预热的"猜测性" walk。
   */
  prefetch(): void {
    if (this.built || this.buildPromise) return;
    // 已知非 vault → 直接早退,不再 lstat(避免 monorepo 浏览每个目录都跑一次)
    if (this.vaultChecked === false) return;
    void (async () => {
      try {
        if (this.vaultChecked === null) {
          this.vaultChecked = await isObsidianVault(this.cwd);
        }
        if (!this.vaultChecked) {
          // 非 vault 不预热;留 byBasename 为空,若后续真有 resolve 请求会走
          // ensureBuilt 按需 build(那时用户已显式表达意图)
          return;
        }
        await this.ensureBuilt();
      } catch (err) {
        logger.debug({ err }, 'WorkspaceIndex prefetch failed (silent)');
      }
    })();
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
 * 排除目录规则:除了 Obsidian 视角的无意义噪声外,还硬排几大类**构建/依赖/
 * 缓存**目录 —— 即便 vault 根真存在这些(monorepo / 项目内 vault),这些目录
 * 里的 .md 也几乎全是第三方 README / 自动生成产物,不是用户笔记,
 * 扫了反而拖垮性能 + 污染解析候选。
 *
 * 设计原则:**已知无价值** > 误杀风险。若某用户真把笔记放在 `vendor/notes/`
 * 之类的目录里(极少),可后续做白名单配置;现状先用保守屏蔽。
 *
 * **仍不跳一般以 `.` 开头的目录**(如 `.claude/`, `.config/`),因为这些常包含
 * 用户实际想要 wikilink 的笔记/规则文档。这跟 file-browser 的"展示隐藏"逻辑
 * 不同 — file-browser 给前端打 hidden 标后由用户 toggle;索引则必须主动决定
 * 是否扫,默认应贴近 Obsidian 行为(尽量全扫,只屏蔽明显噪声)。
 */
const EXCLUDED_DIRS = new Set([
  // Obsidian / VCS / 系统级
  '.git', '.svn', '.hg', '.obsidian', '.trash',

  // JS/TS 生态(node_modules 单独提是因为它通常含上万 README.md)
  'node_modules', '.pnpm-store', '.yarn',
  '.next', '.nuxt', '.svelte-kit', '.astro', '.vercel', '.turbo',
  'dist', 'build', 'out', 'coverage', '.nyc_output',

  // Python / Rust / Java / Go / Ruby / PHP
  '.venv', 'venv', '__pycache__', '.pytest_cache', '.mypy_cache', '.ruff_cache', '.tox',
  'target',
  '.gradle', '.mvn',
  'vendor',

  // IDE / 编辑器
  '.idea', '.vs', '.vscode-test',

  // 通用缓存
  '.cache', '.parcel-cache',
]);

/**
 * 并发 walk:同一目录下的子目录用 Promise.all 并行 readdir,加速大 vault。
 * 实测 /mnt/d/github/documents(508 md / WSL DrvFs)从 5.2s 降到 ~1s。
 *
 * Why 不无限并发:同一时刻太多 readdir 会被 OS 卡住(WSL/macOS 有 fd 限制)。
 * 但 BFS 同层并行是合理上限 — 大 vault 同层目录通常 < 50 个,fd 压力可控。
 */
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
  const subWalks: Array<Promise<void>> = [];
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
      // 同层子目录 fire-and-forget,父等 Promise.all 汇合
      subWalks.push(walk(root, full, onFile));
    } else if (e.isFile() || e.isSymbolicLink()) {
      const rel = relative(root, full).split(sep).join('/');
      onFile(rel);
    }
  }
  if (subWalks.length > 0) await Promise.all(subWalks);
}

async function isDir(p: string): Promise<boolean> {
  try {
    return (await fsp.stat(p)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * cwd 是否 Obsidian vault:根目录有 `.obsidian/` 即认。
 *
 * Obsidian 启动会在 vault 根写入 `.obsidian/`(存配置/插件/workspace 等),
 * 这是用 `*.md` 还是真"vault 想要 wikilink 索引"的唯一可靠区分。
 * 仅检查 dir 存在,不打开内容(性能优先;.obsidian 是 fs.lstat 一次的事)。
 */
export async function isObsidianVault(cwd: string): Promise<boolean> {
  try {
    const st = await fsp.lstat(join(cwd, '.obsidian'));
    return st.isDirectory();
  } catch {
    return false;
  }
}
