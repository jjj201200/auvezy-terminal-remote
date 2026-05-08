/**
 * Host alias 持久化（localStorage）
 *
 * 当前 webapp 只连接一个 backend，所有实例 host 都相同 —— 但产品定位是：
 * 未来支持"多主机管理"（webapp 同时管多台 atr 主机的实例）。host alias
 * 是这条路线的第一块基础：让用户给每台 host 起一个自定义名字。
 *
 * 存储格式（localStorage key: 'atr.host_aliases'）：
 *   { "192.168.1.5": "我的台式机", "100.104.50.64": "Tailscale 笔记本" }
 *
 * 设计：
 *  - 不存 token / port 等敏感或频变字段，只存 host → alias 映射
 *  - 跨 origin 共享（每个 backend 独立有自己的 localStorage —— 这是限制，
 *    但当前架构下仍是 best effort：用户主要在一台机器上管理时仍然有效）
 *  - host 用作 key 是直接的 IP / hostname，不规范化（IPv6 加方括号原样保留）
 */

const STORAGE_KEY = 'atr.host_aliases';

export type HostAliases = Record<string, string>;

/** 读全部 alias map（损坏 / 不存在则返回空对象） */
export function loadHostAliases(): HostAliases {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: HostAliases = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof k === 'string' && typeof v === 'string') out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

/** 写一个 host 的 alias；空字符串等价于删除该 host 的别名 */
export function setHostAlias(host: string, alias: string): void {
  try {
    const map = loadHostAliases();
    const trimmed = alias.trim();
    if (trimmed.length === 0) {
      delete map[host];
    } else {
      map[host] = trimmed;
    }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    /* 写失败忽略：localStorage 满 / 隐私模式禁用 */
  }
}

/** 拿单个 host 的 alias；不存在返回 undefined（让调用方决定 fallback） */
export function getHostAlias(host: string): string | undefined {
  const map = loadHostAliases();
  return map[host];
}
