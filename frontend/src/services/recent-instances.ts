/**
 * recent-instances
 *
 * 最近创建过的实例(本机持久化,LRU)。
 *
 * 设计:
 *  - localStorage key: 'ocr.recentInstances'
 *  - 上限 5 条;新条目从头部插入,超出 push 出尾部
 *  - 按 cwd 去重(同 cwd 多次创建 → 留最新 name + 提到头部)
 *  - 仅本机持久化,不同步给其他设备
 */

const STORAGE_KEY = 'ocr.recentInstances';
const MAX_ENTRIES = 5;

export interface RecentInstance {
  cwd: string;
  name?: string;
  /** 最近一次使用时间(用作排序兜底,主要靠数组顺序) */
  lastUsedAt: number;
}

function readRaw(): RecentInstance[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (x): x is RecentInstance =>
        typeof x === 'object' &&
        x !== null &&
        typeof (x as RecentInstance).cwd === 'string',
    );
  } catch {
    return [];
  }
}

function writeRaw(list: RecentInstance[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    /* 隐私模式 / 配额满:忽略 */
  }
}

export function getRecentInstances(): RecentInstance[] {
  return readRaw();
}

/** 记录一次创建。同 cwd 提到头部并更新 name;新条目从头插入;超 5 条砍尾 */
export function pushRecentInstance(entry: { cwd: string; name?: string }): void {
  const cwd = entry.cwd.trim();
  if (!cwd) return;
  const list = readRaw().filter((e) => e.cwd !== cwd);
  list.unshift({
    cwd,
    name: entry.name?.trim() || undefined,
    lastUsedAt: Date.now(),
  });
  writeRaw(list.slice(0, MAX_ENTRIES));
}

/** 用户主动删一条 */
export function removeRecentInstance(cwd: string): void {
  writeRaw(readRaw().filter((e) => e.cwd !== cwd));
}
