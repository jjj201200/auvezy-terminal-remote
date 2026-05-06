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
import { fetchInstances, createInstance } from '../services/instance-api.js';

const INSTANCE_POLL_INTERVAL_MS = 5_000;

export interface UseInstancesResult {
  instances: InstanceListItem[];
  loading: boolean;
  error: string | null;
  /** 强制立即重新 fetch */
  reload: () => Promise<void>;
  /** 创建新实例；成功返回 null，失败返回错误信息 */
  create: (cwd: string, name?: string) => Promise<string | null>;
}

export function useInstances(): UseInstancesResult {
  const [instances, setInstances] = useState<InstanceListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reload = useCallback(async (): Promise<void> => {
    const r = await fetchInstances();
    if (r.ok && r.data) {
      setInstances(r.data.instances);
      setError(null);
    } else if (r.status !== 0) {
      // status=0 表示网络/取消导致的瞬时失败，不显示错误
      setError(r.error?.message ?? '实例列表加载失败');
    }
    setLoading(false);
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
        // 子进程派生成功 ≠ 立刻在 instances.json 注册——子进程要起 PTY、findPort、
        // 写 registry，整个过程约 200~1500ms。立即 reload 大概率拿不到。
        // 多次重试直到看到新 pid，或等到下一次轮询兜底（5s）。
        const expectedPid = r.data.instance.pid;
        const delays = [200, 500, 1000, 2000];
        void (async () => {
          for (const delay of delays) {
            await new Promise((res) => setTimeout(res, delay));
            await reload();
            // setInstances 是异步的，用 fetchInstances 直接取一次确认是否到了
            const check = await fetchInstances();
            if (check.ok && check.data?.instances.some((i) => i.pid === expectedPid)) return;
          }
        })();
        return null;
      }
      const msg = r.error?.message ?? '创建实例失败';
      setError(msg);
      return msg;
    },
    [reload],
  );

  return { instances, loading, error, reload, create };
}
