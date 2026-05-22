/**
 * resolve-link client — 调 POST /api/files/resolve-links
 *
 * 设计:
 *  - **批量**:同一 markdown 文档内多个 wikilink 通过 microtask 合并为一次请求
 *    (一个 md 文档常 10+ wikilinks,逐个 RTT 卡顿)
 *  - **LRU 缓存** 500 条:(instanceId, from, target) → ResolveResult
 *    避免重渲染 / 不同文档对同名 target 重复打
 *  - **错误降级**:网络失败 / 超时 → 视为 broken,UI 仍能渲染 disabled 样式
 *
 * 请求路径走绝对 `/api/files/resolve-links`(file-routes 是 broker 系统级,
 * 详见 files-api.ts 注释)。
 */

export interface Anchor {
  kind: 'heading' | 'block';
  id: string;
}

export interface WikilinkResult {
  target: string;
  resolved?: string;
  candidates?: string[];
  fragment?: Anchor;
  broken?: true;
}

const CACHE_LIMIT = 500;
const cache = new Map<string, WikilinkResult>();

interface PendingBatch {
  /** from → set of targets(同 from 共一次请求) */
  byFrom: Map<string, Set<string>>;
  /** key = `${instanceId}\0${from}\0${target}` → 等待结果的 callback 们 */
  resolvers: Map<string, Array<(r: WikilinkResult) => void>>;
  timer: ReturnType<typeof setTimeout> | null;
}

const pending = new Map<string, PendingBatch>();

function cacheKey(instanceId: string, from: string, target: string): string {
  return `${instanceId}\0${from}\0${target}`;
}

export function resolveLink(
  instanceId: string,
  from: string,
  target: string,
): Promise<WikilinkResult> {
  const key = cacheKey(instanceId, from, target);
  const cached = cache.get(key);
  if (cached) {
    // LRU touch:删后重插 → 移到 Map 末尾
    cache.delete(key);
    cache.set(key, cached);
    return Promise.resolve(cached);
  }

  let batch = pending.get(instanceId);
  if (!batch) {
    batch = { byFrom: new Map(), resolvers: new Map(), timer: null };
    pending.set(instanceId, batch);
  }

  let fromSet = batch.byFrom.get(from);
  if (!fromSet) {
    fromSet = new Set();
    batch.byFrom.set(from, fromSet);
  }
  fromSet.add(target);

  return new Promise((resolve) => {
    const arr = batch.resolvers.get(key) ?? [];
    arr.push(resolve);
    batch.resolvers.set(key, arr);
    if (!batch.timer) {
      // microtask + 一次 setTimeout(0) — 让同一同步代码区里 N 次 resolveLink
      // 合并;非 0 timeout 是 microtask 边界
      batch.timer = setTimeout(() => {
        void flushBatch(instanceId);
      }, 0);
    }
  });
}

async function flushBatch(instanceId: string): Promise<void> {
  const batch = pending.get(instanceId);
  if (!batch) return;
  pending.delete(instanceId);
  batch.timer = null;

  for (const [from, targetSet] of batch.byFrom) {
    const targets = [...targetSet];
    let results: WikilinkResult[];
    try {
      const res = await fetch('/api/files/resolve-links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ instanceId, from, targets }),
      });
      if (res.ok) {
        const data = (await res.json()) as { ok: boolean; results: WikilinkResult[] };
        results = data.results;
      } else {
        results = targets.map((t) => ({ target: t, broken: true as const }));
      }
    } catch {
      results = targets.map((t) => ({ target: t, broken: true as const }));
    }

    for (const r of results) {
      const key = cacheKey(instanceId, from, r.target);
      // LRU 容量管理:删除最早项(Map 迭代顺序 = 插入顺序)
      if (cache.size >= CACHE_LIMIT) {
        const firstKey = cache.keys().next().value;
        if (firstKey) cache.delete(firstKey);
      }
      cache.set(key, r);
      for (const cb of batch.resolvers.get(key) ?? []) cb(r);
    }
  }
}

/** Test-only:清空 LRU(测试用 vi.stubGlobal 切换 fetch mock 时调) */
export function clearResolveLinkCache(): void {
  cache.clear();
  pending.clear();
}
