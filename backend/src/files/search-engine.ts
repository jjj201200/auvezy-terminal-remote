/**
 * search-engine:文件名 + 内容搜索
 *
 * 设计要点(design §5.5):
 *  - 递归遍历 scope 目录,深度 ≤ MAX_DEPTH,单请求扫描 entry 数 ≤ MAX_ENTRIES_SCANNED
 *  - 忽略目录硬编码列表(node_modules / dist / .git ...)
 *  - 二进制文件跳过(前 4 KiB 含 NUL)
 *  - 单文件总扫描 SEARCH_FILE_TIMEOUT_MS 硬超时
 *  - 全请求总预算 SEARCH_TOTAL_TIMEOUT_MS
 *  - 并发文件数 SEARCH_CONCURRENCY
 *  - regex 含 \n / 编译失败 → SEARCH_INVALID_Q
 *  - 取消信号(req.close)立即停止
 */

import { opendir, open, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import {
  ErrorCode,
  SEARCH_FILE_TIMEOUT_MS,
  SEARCH_TOTAL_TIMEOUT_MS,
  SEARCH_CONCURRENCY,
  SEARCH_MAX_NAME_RESULTS,
  SEARCH_MAX_CONTENT_RESULTS,
  type SearchEvent,
  type SearchMode,
} from 'auvezy-terminal-remote-shared';
import { FileError } from '../errors.js';
import { checkWorkdir } from '../utils/workdir-policy.js';

/** 硬编码忽略目录(不递归进入) */
const IGNORE_DIRS = new Set([
  'node_modules', '.git', '.svn', '.hg',
  'dist', 'build', '.next', '.turbo', '.cache', 'target',
  '.venv', '__pycache__', '.DS_Store',
]);
const MAX_DEPTH = 6;
const MAX_ENTRIES_SCANNED = 5000;
const NUL_PROBE_BYTES = 4 * 1024;
const PREVIEW_MAX_CHARS = 200;
const FILE_MAX_SCAN_BYTES = 2 * 1024 * 1024;

export type SearchHit = SearchEvent;

export interface SearchOptions {
  scope: string;
  q: string;
  mode: SearchMode;
  caseSensitive: boolean;
  regex: boolean;
  policy: { allow: readonly string[]; deny: readonly string[] };
  emit: (hit: SearchHit) => void;
  /** 提前取消(请求 close 时由路由层 abort) */
  cancelSignal?: AbortSignal;
}

export interface SearchSummary {
  truncated: boolean;
  scanned: number;
  elapsedMs: number;
}

/**
 * 执行搜索;边搜索边通过 `emit` 推送命中事件。
 *
 * @throws FileError(SEARCH_INVALID_Q) 当 regex 含换行或编译失败
 */
export async function runSearch(opts: SearchOptions): Promise<SearchSummary> {
  const start = Date.now();
  let scanned = 0;
  let nameHits = 0;
  let contentHits = 0;
  let truncated = false;

  // 编译 matcher
  const matchers = compileMatchers(opts);
  const { nameMatch, contentMatch } = matchers;

  // 收集候选文件(name 命中 + 待 content 扫描)
  const candidates: string[] = [];

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > MAX_DEPTH) return;
    if (scanned >= MAX_ENTRIES_SCANNED) { truncated = true; return; }
    if (Date.now() - start > SEARCH_TOTAL_TIMEOUT_MS) { truncated = true; return; }
    if (opts.cancelSignal?.aborted) return;

    let dirh;
    try {
      dirh = await opendir(dir);
    } catch {
      return;
    }

    for await (const ent of dirh) {
      scanned++;
      if (scanned >= MAX_ENTRIES_SCANNED) { truncated = true; break; }
      if (Date.now() - start > SEARCH_TOTAL_TIMEOUT_MS) { truncated = true; break; }
      if (opts.cancelSignal?.aborted) break;

      const full = join(dir, ent.name);

      if (ent.isDirectory()) {
        if (IGNORE_DIRS.has(ent.name)) continue;
        // policy 闸:子目录命中 deny 整段跳
        if (checkWorkdir(full, opts.policy.allow, opts.policy.deny) !== null) continue;
        await walk(full, depth + 1);
        continue;
      }

      if (!ent.isFile()) continue;

      // name 模式
      if (opts.mode !== 'content' && nameMatch(ent.name) && nameHits < SEARCH_MAX_NAME_RESULTS) {
        try {
          const st = await stat(full);
          opts.emit({ kind: 'name', path: full, size: st.size, mtimeMs: st.mtimeMs });
          nameHits++;
        } catch {
          // stat 失败 → 不计 hit
        }
      }

      if (opts.mode !== 'name') candidates.push(full);
    }
  }

  await walk(opts.scope, 0);

  // content 扫描:并发处理
  if (opts.mode !== 'name' && candidates.length > 0) {
    const queue = candidates.slice();
    const workers: Promise<void>[] = [];
    for (let i = 0; i < SEARCH_CONCURRENCY; i++) {
      workers.push((async (): Promise<void> => {
        while (queue.length > 0) {
          if (contentHits >= SEARCH_MAX_CONTENT_RESULTS) { truncated = true; return; }
          if (Date.now() - start > SEARCH_TOTAL_TIMEOUT_MS) { truncated = true; return; }
          if (opts.cancelSignal?.aborted) return;
          const f = queue.shift();
          if (!f) return;
          await scanFile(f);
        }
      })());
    }
    await Promise.all(workers);
  }

  async function scanFile(path: string): Promise<void> {
    const fileStart = Date.now();
    let st;
    try {
      st = await stat(path);
    } catch {
      return;
    }
    if (st.size > FILE_MAX_SCAN_BYTES) return;

    // 字节级 NUL 闸:二进制跳过
    try {
      const fh = await open(path, 'r');
      try {
        const probeLen = Math.min(NUL_PROBE_BYTES, st.size);
        if (probeLen > 0) {
          const buf = Buffer.alloc(probeLen);
          await fh.read(buf, 0, probeLen, 0);
          if (buf.includes(0x00)) return;
        }
      } finally {
        await fh.close();
      }
    } catch {
      return;
    }

    // 流式按行
    await new Promise<void>((resolveP) => {
      const stream = createReadStream(path, { encoding: 'utf-8' });
      const rl = createInterface({ input: stream, crlfDelay: Infinity });
      let lineNo = 0;
      let stopped = false;
      const stop = (): void => {
        if (stopped) return;
        stopped = true;
        rl.close();
        stream.destroy();
        resolveP();
      };
      rl.on('line', (line) => {
        lineNo++;
        if (Date.now() - fileStart > SEARCH_FILE_TIMEOUT_MS) { stop(); return; }
        if (contentHits >= SEARCH_MAX_CONTENT_RESULTS) { truncated = true; stop(); return; }
        if (opts.cancelSignal?.aborted) { stop(); return; }
        const m = contentMatch(line);
        if (m) {
          const preview = line.length > PREVIEW_MAX_CHARS
            ? line.slice(0, PREVIEW_MAX_CHARS)
            : line;
          opts.emit({
            kind: 'content',
            path,
            line: lineNo,
            preview,
            matchStart: Math.min(m.start, preview.length),
            matchEnd: Math.min(m.end, preview.length),
          });
          contentHits++;
        }
      });
      rl.on('close', () => resolveP());
      rl.on('error', () => stop());
      stream.on('error', () => stop());
    });
  }

  return {
    truncated,
    scanned,
    elapsedMs: Date.now() - start,
  };
}

interface Matchers {
  nameMatch: (name: string) => boolean;
  contentMatch: (line: string) => { start: number; end: number } | null;
}

function compileMatchers(opts: SearchOptions): Matchers {
  if (opts.regex) {
    if (opts.q.includes('\n')) {
      throw new FileError(
        ErrorCode.SEARCH_INVALID_Q,
        'cross-line regex disallowed',
        400,
      );
    }
    let re: RegExp;
    try {
      re = new RegExp(opts.q, opts.caseSensitive ? '' : 'i');
    } catch (err) {
      throw new FileError(
        ErrorCode.SEARCH_INVALID_Q,
        `invalid regex: ${String(err)}`,
        400,
      );
    }
    return {
      nameMatch: (n) => re.test(n),
      contentMatch: (line) => {
        const m = re.exec(line);
        re.lastIndex = 0;
        return m ? { start: m.index, end: m.index + m[0].length } : null;
      },
    };
  }
  const needle = opts.caseSensitive ? opts.q : opts.q.toLowerCase();
  return {
    nameMatch: (n) => (opts.caseSensitive ? n : n.toLowerCase()).includes(needle),
    contentMatch: (line) => {
      const hay = opts.caseSensitive ? line : line.toLowerCase();
      const idx = hay.indexOf(needle);
      return idx === -1 ? null : { start: idx, end: idx + needle.length };
    },
  };
}
