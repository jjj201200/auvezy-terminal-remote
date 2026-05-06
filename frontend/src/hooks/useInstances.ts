/**
 * useInstances
 *
 * 拉取并定期刷新实例列表。
 *
 * 设计：
 *  - 首次挂载立即 fetch
 *  - 之后每 INSTANCE_POLL_INTERVAL_MS 轮询一次（轻量请求，5s 默认）
 *  - 创建新实例后调用 reload() 强制立即刷新
 *  - 失败时不破坏已有 list（保留上一次成功值），只 setError
 *
 * 不做的事：
 *  - 跨实例 WebSocket 实时同步（轮询足够）
 *  - 自动重定向到其它实例（由 InstanceTabs 内 onClick 决定）
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { InstanceListItem } from '@otr/shared';
import { fetchInstances, createInstance, deleteInstance } from '../services/instance-api.js';

const INSTANCE_POLL_INTERVAL_MS = 5_000;

/**
 * 占位实例：modal 关闭后到 backend 注册前，前端用它撑出"骨架 tab"
 * 让用户立刻看到反馈
 */
export interface PendingInstance {
  /** 占位 id（uuid），区别于真实 instanceId */
  pendingId: string;
  cwd: string;
  name: string;
  /** 期望的 pid，用来匹配 backend 的真实记录 */
  expectedPid: number;
  /** 'creating' 创建中 / 'failed' 创建失败（短暂展示后移除） */
  state: 'creating' | 'failed';
  /** 失败时的错误信息 */
  error?: string;
  /** 创建时间戳，用于超时移除 */
  startedAt: number;
}

export interface UseInstancesResult {
  instances: InstanceListItem[];
  pending: PendingInstance[];
  loading: boolean;
  error: string | null;
  /** 强制立即重新 fetch；返回最新列表（也写到内部 state） */
  reload: () => Promise<InstanceListItem[]>;
  /** 创建新实例；成功返回 null，失败返回错误信息 */
  create: (cwd: string, name?: string) => Promise<string | null>;
  /** 删除（关闭）实例 */
  remove: (instanceId: string) => Promise<string | null>;
}

export function useInstances(): UseInstancesResult {
  const [instances, setInstances] = useState<InstanceListItem[]>([]);
  const [pending, setPending] = useState<PendingInstance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reload = useCallback(async (): Promise<InstanceListItem[]> => {
    const r = await fetchInstances();
    if (r.ok && r.data) {
      setInstances(r.data.instances);
      setError(null);
      // 拿到列表后，把对应到的 pending 项移除（pid 命中）
      setPending((prev) =>
        prev.filter((p) => !r.data!.instances.some((i) => i.pid === p.expectedPid)),
      );
      return r.data.instances;
    }
    if (r.status !== 0) {
      setError(r.error?.message ?? '实例列表加载失败');
    }
    setLoading(false);
    return [];
  }, []);

  // 首次 + 定时轮询
  useEffect(() => {
    let alive = true;
    const tick = async (): Promise<void> => {
      if (!alive) return;
      await reload();
      if (!alive) return;
      timerRef.current = setTimeout(tick, INSTANCE_POLL_INTERVAL_MS);
    };
    void tick();
    return () => {
      alive = false;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [reload]);

  const create = useCallback(
    async (cwd: string, name?: string): Promise<string | null> => {
      const r = await createInstance({ cwd, name });
      if (r.ok && r.data) {
        // 立即插入一个 pending 占位项，让 InstanceTabs 显示骨架 tab
        const pendingId = `pending-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const expectedPid = r.data.instance.pid;
        setPending((prev) => [
          ...prev,
          {
            pendingId,
            cwd: r.data!.instance.cwd,
            name: r.data!.instance.name,
            expectedPid,
            state: 'creating',
            startedAt: Date.now(),
          },
        ]);

        // 多次重试 reload，直到 backend 注册了新 pid
        const delays = [200, 500, 1000, 2000];
        void (async () => {
          for (const delay of delays) {
            await new Promise((res) => setTimeout(res, delay));
            const list = await reload();
            if (list.some((i) => i.pid === expectedPid)) return; // 命中 → reload 内已移除 pending
          }
          // 超时（轮询会兜底；这里把 pending 标记 failed 短暂展示再移除）
          setPending((prev) =>
            prev.map((p) =>
              p.pendingId === pendingId
                ? { ...p, state: 'failed', error: '注册超时' }
                : p,
            ),
          );
          setTimeout(() => {
            setPending((prev) => prev.filter((p) => p.pendingId !== pendingId));
          }, 4000);
        })();
        return null;
      }
      const msg = r.error?.message ?? '创建实例失败';
      setError(msg);
      return msg;
    },
    [reload],
  );

  const remove = useCallback(
    async (instanceId: string): Promise<string | null> => {
      const r = await deleteInstance(instanceId);
      if (r.ok) {
        // 立即从本地列表移除（后端已 SIGTERM，下次 reload 也会清掉）
        setInstances((prev) => prev.filter((i) => i.instanceId !== instanceId));
        return null;
      }
      return r.error?.message ?? '关闭实例失败';
    },
    [],
  );

  return { instances, pending, loading, error, reload, create, remove };
}
