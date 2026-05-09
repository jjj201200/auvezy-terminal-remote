/**
 * useHostRegistry
 *
 * React 视角的 host registry：拿到当前列表 + 提供 upsert / remove 操作 + 自动重读。
 *
 * 设计：
 *  - 不订阅 storage event（跨 tab 同步暂不需要，本应用都同 origin 单 tab 用）
 *  - 调 upsert / remove 后内部 force update，让消费组件立刻看到新数据
 *  - 当前 backend 的 host（"自己")由调用方传入，会自动确保它至少作为一条
 *    隐式 entry 被列出（即使用户没显式登记过）
 */

import { useCallback, useMemo, useReducer } from 'react';
import {
  loadHostRegistry,
  upsertHost,
  removeHost,
  type HostEntry,
} from '../services/host-aliases.js';

export interface UseHostRegistryOptions {
  /**
   * 当前 backend 的 host（如 '192.168.1.5' / '100.104.50.64'）。
   * 即使该 host 没在 registry 里，也会作为隐式 entry 出现在 hosts 列表第一位
   * （alias 取已有 alias 或 host 本身）
   */
  currentHost?: string | null;
}

export interface UseHostRegistryResult {
  hosts: HostEntry[];
  /** 当前 backend host 的展示名（alias 或 host 本身） */
  currentHostDisplay: string;
  /** 给定 host 找展示名 */
  displayOf: (host: string) => string;
  /** 添加 / 重命名（alias 必填非空） */
  upsert: (host: string, alias: string) => void;
  /** 删除一条登记 */
  remove: (host: string) => void;
}

export function useHostRegistry(opts: UseHostRegistryOptions = {}): UseHostRegistryResult {
  const { currentHost } = opts;
  const [tick, bump] = useReducer((n: number) => n + 1, 0);

  const stored = useMemo(() => {
    void tick; // 让 useMemo 依赖 tick，强制重读
    return loadHostRegistry();
  }, [tick]);

  const hosts = useMemo<HostEntry[]>(() => {
    if (!currentHost) return stored;
    // 隐式补一条当前 backend host（如果用户还没登记过）
    if (stored.some((h) => h.host === currentHost)) return stored;
    const implicit: HostEntry = {
      host: currentHost,
      alias: currentHost,
      addedAt: new Date(0).toISOString(), // epoch=0 让它排在最前
    };
    return [implicit, ...stored];
  }, [stored, currentHost]);

  const displayOf = useCallback(
    (host: string): string => {
      const h = hosts.find((x) => x.host === host);
      return h?.alias ?? host;
    },
    [hosts],
  );

  const currentHostDisplay = currentHost ? displayOf(currentHost) : '';

  const upsert = useCallback((host: string, alias: string) => {
    upsertHost(host, alias);
    bump();
  }, []);

  const remove = useCallback((host: string) => {
    removeHost(host);
    bump();
  }, []);

  return { hosts, currentHostDisplay, displayOf, upsert, remove };
}
