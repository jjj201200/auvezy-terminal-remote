/**
 * useHostGroups
 *
 * 把 instances + pending 按 host 分组。当前 webapp 一次只连一个 backend，
 * 所以理论上只有 1 个 host group；这个 hook 是为未来"多主机管理"留的
 * 数据结构骨架。
 *
 * 返回：
 *   - groups: 按 host 分组、host 内按启动时间稳定排序
 *   - hasSingleHost: 当前是否只有一个 host（用于决定要不要显示 host header
 *     —— 单 host 时显示 header 是视觉冗余）
 *
 * pending 项也会被分到对应的 group：
 *   - 有 host 字段（远端 spawn）→ 进对应 group
 *   - 无 host（本地 spawn 还没注册回来）→ 进当前 backend 的 host group
 *     （我们用 instances[0].host 作为推断；都没的话进 'unknown' group）
 */

import { useMemo } from 'react';
import type { InstanceListItem } from 'auvezy-terminal-remote-shared';
import type { PendingInstance } from './useInstances.js';
import { loadHostAliases } from '../services/host-aliases.js';

export interface HostGroup {
  /** 原始 host（IP / hostname），作为 alias map 的 key */
  host: string;
  /** 显示名：用户自定义 alias > host 本身 */
  displayName: string;
  /** 用户是否给该 host 起过 alias */
  hasAlias: boolean;
  instances: InstanceListItem[];
  pending: PendingInstance[];
}

export interface UseHostGroupsResult {
  groups: HostGroup[];
  hasSingleHost: boolean;
}

export function useHostGroups(
  instances: InstanceListItem[],
  pending: PendingInstance[],
  /**
   * 改 alias 后由调用方递增（如 useReducer counter），让 useMemo 重新读 localStorage。
   * 不传 = alias 改了不会自动反映（首次 mount 时读的快照固定）
   */
  aliasInvalidationToken?: number,
): UseHostGroupsResult {
  return useMemo(() => {
    const aliases = loadHostAliases();
    const map = new Map<string, HostGroup>();

    // 分组键策略(0.7.x):
    //  - 优先用 instance.brokerHost(broker 注册时填的对外可达 host,真正区分"哪台机")
    //  - 没有则 fallback 到 instance.host(0.6.x 老数据兼容)
    //  - 仍没有 → 'unknown'
    // 注:0.7.0 ADR-009 起 instance.host 永远是 "127.0.0.1"(worker loopback),
    // 单纯按 host 分组会让所有机器实例顶到同一组 —— brokerHost 是修复方案
    const groupKey = (i: { brokerHost?: string; host: string }): string =>
      i.brokerHost ?? i.host ?? 'unknown';

    // 推断"当前 backend"的 host:用第一条 instance 的 groupKey
    const fallbackHost = instances[0] ? groupKey(instances[0]) : 'unknown';

    const ensureGroup = (host: string): HostGroup => {
      const existing = map.get(host);
      if (existing) return existing;
      const alias = aliases[host];
      const group: HostGroup = {
        host,
        displayName: alias ?? host,
        hasAlias: alias !== undefined,
        instances: [],
        pending: [],
      };
      map.set(host, group);
      return group;
    };

    for (const i of instances) {
      ensureGroup(groupKey(i)).instances.push(i);
    }

    for (const p of pending) {
      // PendingInstance 当前类型不带 host —— 都归 fallbackHost
      ensureGroup(fallbackHost).pending.push(p);
    }

    // 按 host 字典序稳定排序（未来多 host 时让 UI 顺序稳定）
    const groups = Array.from(map.values()).sort((a, b) =>
      a.host.localeCompare(b.host),
    );

    return {
      groups,
      hasSingleHost: groups.length <= 1,
    };
  }, [instances, pending, aliasInvalidationToken]);
}
