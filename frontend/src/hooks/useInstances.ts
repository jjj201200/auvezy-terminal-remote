/**
 * useInstances
 *
 * 拉取并实时同步实例列表。
 *
 * 数据源（优先级）：
 *  1. SSE /api/instances/stream — 文件 watcher 触发，几十毫秒级；主路径
 *  2. 30s 兜底轮询 — SSE 断 / 浏览器后台节流时维持最终一致
 *  3. create() 后短期内额外 reload —— SSE 通常 1-2s 内推过来，但留个兜底拉一次
 *
 * 设计：
 *  - 不再自己拍"创建超时"：以 backend 真实 register 为准（SSE 推送）
 *  - 60s 仍未命中 expectedPid → pending 标 failed，但保留 tab，由用户手动重连 / 关闭
 *  - 失败 pending 不自动消失（之前 4s 自动删的设计太激进，用户来不及反应）
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { InstanceListItem } from 'auvezy-terminal-remote-shared';
import { fetchInstances, createInstance, deleteInstance } from '../services/instance-api.js';

const FALLBACK_POLL_INTERVAL_MS = 30_000;
const PENDING_TIMEOUT_MS = 60_000;

/**
 * 占位实例：modal 关闭后到 backend register 之前，前端用它撑出"骨架 tab"
 */
export interface PendingInstance {
  /** 占位 id（uuid），区别于真实 instanceId */
  pendingId: string;
  cwd: string;
  name: string;
  /** 期望的 pid，匹配 backend register 的真实记录 */
  expectedPid: number;
  /** 'creating' = 等 SSE 推送 / 'failed' = 60s 兜底超时（用户手动决定下一步） */
  state: 'creating' | 'failed';
  /** 失败时的错误信息（轮询超时 = "注册超时"，请求失败 = api 报错） */
  error?: string;
  /** 创建时间戳，用于超时判定 */
  startedAt: number;
}

export interface UseInstancesResult {
  instances: InstanceListItem[];
  pending: PendingInstance[];
  loading: boolean;
  error: string | null;
  /** 强制立即重新 fetch；返回最新列表 */
  reload: () => Promise<InstanceListItem[]>;
  /** 创建新实例；成功返回 null，失败返回错误信息 */
  create: (cwd: string, name?: string) => Promise<string | null>;
  /** 关闭实例（DELETE /api/instances/:id） */
  remove: (instanceId: string) => Promise<string | null>;
  /** 重新等一个失败的 pending：把 state 改回 creating + 立即拉一次 + 重置超时 */
  retryPending: (pendingId: string) => void;
  /** 关闭一个 pending tab（仅 UI 层移除，不调 DELETE；用于用户放弃等待） */
  dismissPending: (pendingId: string) => void;
}

export function useInstances(): UseInstancesResult {
  const [instances, setInstances] = useState<InstanceListItem[]>([]);
  const [pending, setPending] = useState<PendingInstance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 用 ref 持有最新 instances，给 SSE / 超时回调读（闭包外避免 stale）
  const instancesRef = useRef<InstanceListItem[]>([]);
  instancesRef.current = instances;

  /**
   * 应用一份新 list：写 state + 移除已命中真实实例的 pending。
   *
   * 命中规则（pid 优先，cwd 兜底）：
   *  1. pid 直接相等 —— 生产模式（spawner 用 node dist/cli.js，child.pid = process.pid）
   *  2. dev 模式下 spawner 拿到的是 tsx wrapper pid，跟 backend 子进程 register 的
   *     process.pid 不一致 → 退化用 (cwd 一致 && instance.startedAt 在 pending 之后) 兜底
   *     已被命中过的 instance 不复用，避免一个真实条目被多个 pending 抢匹配
   */
  const applyList = useCallback((list: InstanceListItem[]): void => {
    setInstances(list);
    setError(null);
    setLoading(false);
    setPending((prev) => {
      const claimed = new Set<string>();
      return prev.filter((p) => {
        const hit = list.find((i) => {
          if (claimed.has(i.instanceId)) return false;
          if (i.pid === p.expectedPid) return true;
          if (i.cwd === p.cwd) {
            const ts = new Date(i.startedAt).getTime();
            if (Number.isFinite(ts) && ts >= p.startedAt - 1000) return true;
          }
          return false;
        });
        if (hit) {
          claimed.add(hit.instanceId);
          return false; // 移除该 pending（命中）
        }
        return true; // 保留（未命中）
      });
    });
  }, []);

  const reload = useCallback(async (): Promise<InstanceListItem[]> => {
    const r = await fetchInstances();
    if (r.ok && r.data) {
      applyList(r.data.instances);
      return r.data.instances;
    }
    if (r.status !== 0) {
      setError(r.error?.message ?? '实例列表加载失败');
    }
    setLoading(false);
    return [];
  }, [applyList]);

  // SSE 主通道 + 30s 兜底轮询 + 首次 reload
  useEffect(() => {
    let alive = true;
    let es: EventSource | null = null;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;

    const startPolling = (): void => {
      const tick = async (): Promise<void> => {
        if (!alive) return;
        await reload();
        if (!alive) return;
        pollTimer = setTimeout(tick, FALLBACK_POLL_INTERVAL_MS);
      };
      void tick();
    };

    const startSse = (): void => {
      try {
        // 0.7.0 v2：所有 /api/* 命中 broker 根，不再走 /i/<id>/api/...
        es = new EventSource('/api/instances/stream', { withCredentials: true });
      } catch {
        // 不支持 EventSource → 仅靠轮询
        startPolling();
        return;
      }
      es.addEventListener('instances', (ev) => {
        try {
          const payload = JSON.parse((ev as MessageEvent).data) as {
            instances: InstanceListItem[];
          };
          if (Array.isArray(payload.instances)) {
            applyList(payload.instances);
          }
        } catch {
          /* 忽略畸形事件 */
        }
      });
      es.addEventListener('error', () => {
        // SSE 自动重连，但偶尔会卡住 → 触发一次手动 reload，让 UI 不至于永久 stale
        if (alive) void reload();
      });
    };

    startSse();
    startPolling();

    return () => {
      alive = false;
      if (pollTimer) clearTimeout(pollTimer);
      es?.close();
    };
  }, [reload, applyList]);

  /**
   * 启动一个 pending 的"60s 超时" timer：到点把状态翻成 failed
   * 同 pendingId 调用会先 clear 之前的 timer（重连场景）
   *
   * 超时回调里的"已命中"判定也走 pid + cwd/startedAt 兜底，跟 applyList 同款规则
   */
  const pendingTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const armPendingTimeout = useCallback(
    (pendingId: string, expectedPid: number, cwd: string, startedAt: number): void => {
      const old = pendingTimers.current.get(pendingId);
      if (old) clearTimeout(old);
      const timer = setTimeout(() => {
        pendingTimers.current.delete(pendingId);
        const matched = instancesRef.current.some((i) => {
          if (i.pid === expectedPid) return true;
          if (i.cwd === cwd) {
            const ts = new Date(i.startedAt).getTime();
            if (Number.isFinite(ts) && ts >= startedAt - 1000) return true;
          }
          return false;
        });
        if (matched) return;
        setPending((prev) =>
          prev.map((p) =>
            p.pendingId === pendingId
              ? { ...p, state: 'failed', error: '注册超时（点重试再等一会儿，或关闭）' }
              : p,
          ),
        );
      }, PENDING_TIMEOUT_MS);
      pendingTimers.current.set(pendingId, timer);
    },
    [],
  );

  // 卸载时清掉所有 pending timer
  useEffect(() => {
    return () => {
      pendingTimers.current.forEach((t) => clearTimeout(t));
      pendingTimers.current.clear();
    };
  }, []);

  const create = useCallback(
    async (cwd: string, name?: string): Promise<string | null> => {
      const r = await createInstance({ cwd, name });
      if (r.ok && r.data) {
        const pendingId = `pending-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const expectedPid = r.data.instance.pid;
        const realCwd = r.data.instance.cwd;
        const startedAt = Date.now();
        setPending((prev) => [
          ...prev,
          {
            pendingId,
            cwd: realCwd,
            name: r.data!.instance.name,
            expectedPid,
            state: 'creating',
            startedAt,
          },
        ]);
        armPendingTimeout(pendingId, expectedPid, realCwd, startedAt);
        // 兜底拉一次：万一 SSE 断了，主动取一次让 pending 尽快命中
        void reload();
        return null;
      }
      const msg = r.error?.message ?? '创建实例失败';
      setError(msg);
      return msg;
    },
    [reload, armPendingTimeout],
  );

  const remove = useCallback(
    async (instanceId: string): Promise<string | null> => {
      const r = await deleteInstance(instanceId);
      if (r.ok) {
        // 乐观更新：立即从本地移除（SSE 也会推过来，但抢先一步更顺手）
        setInstances((prev) => prev.filter((i) => i.instanceId !== instanceId));
        return null;
      }
      return r.error?.message ?? '关闭实例失败';
    },
    [],
  );

  const retryPending = useCallback((pendingId: string): void => {
    setPending((prev) => {
      const target = prev.find((p) => p.pendingId === pendingId);
      if (!target) return prev;
      armPendingTimeout(pendingId, target.expectedPid, target.cwd, target.startedAt);
      return prev.map((p) =>
        p.pendingId === pendingId ? { ...p, state: 'creating', error: undefined } : p,
      );
    });
    void reload();
  }, [reload, armPendingTimeout]);

  const dismissPending = useCallback((pendingId: string): void => {
    const t = pendingTimers.current.get(pendingId);
    if (t) {
      clearTimeout(t);
      pendingTimers.current.delete(pendingId);
    }
    setPending((prev) => prev.filter((p) => p.pendingId !== pendingId));
  }, []);

  return {
    instances,
    pending,
    loading,
    error,
    reload,
    create,
    remove,
    retryPending,
    dismissPending,
  };
}
