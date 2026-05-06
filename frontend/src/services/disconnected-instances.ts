/**
 * disconnected-instances
 *
 * 本机"主动断开"的实例 id 集合(本地持久化)。
 *
 * 语义:
 *  - 用户在 tab 上选"断开"而非"删除" → instanceId 加入这个集合
 *  - 对应 InstanceView 不开 WebSocket(disabled),展示"已断开 — 点重连"覆盖层
 *  - 用户点重连 → 从集合移除 → InstanceView 自动开 WS
 *  - 仅影响本设备;backend 上的实例进程仍在,其他设备照常用
 *  - 实例被真正删除(不在 list 里)时,顺手清理(避免集合无限增长)
 */

const STORAGE_KEY = 'atr.disconnectedInstances';

function read(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === 'string');
  } catch {
    return [];
  }
}

function write(ids: string[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  } catch {
    /* 隐私模式 / 配额满:忽略 */
  }
}

export function getDisconnected(): string[] {
  return read();
}

export function isDisconnected(instanceId: string): boolean {
  return read().includes(instanceId);
}

/** 标记某实例为"已断开" */
export function markDisconnected(instanceId: string): void {
  const set = new Set(read());
  set.add(instanceId);
  write([...set]);
}

/** 取消断开标记(= 重连) */
export function clearDisconnected(instanceId: string): void {
  write(read().filter((id) => id !== instanceId));
}

/** 与 list 同步:list 里没有的 id 从集合移除(避免无限增长) */
export function pruneDisconnected(liveInstanceIds: string[]): void {
  const live = new Set(liveInstanceIds);
  const cur = read();
  const next = cur.filter((id) => live.has(id));
  if (next.length !== cur.length) write(next);
}
