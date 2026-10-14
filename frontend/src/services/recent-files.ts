/**
 * recent-files：文件浏览「最近查看文件」记录(localStorage,每设备独立)
 *
 * 记录在 FileBrowserSheet 打开预览时写入(文件列表点击 + 搜索命中跳转);
 * 上限来自 UserConfig.recentFilesLimit(0=不记录、-1=不限、正数=条数),
 * 由调用方读取后传入——service 不感知 UserConfig。
 */

const STORAGE_KEY = 'atr.recentFiles.v1';

/** 与 PreviewTarget 结构兼容的序列化形态(kind/path/name + 可选 size/jumpLine) */
export interface RecentFileTarget {
  kind: string;
  path: string;
  name: string;
  size?: number;
  jumpLine?: number;
}

export interface RecentFileEntry {
  instanceId: string;
  target: RecentFileTarget;
  /** 毫秒时间戳(展示用;排序主要靠数组序) */
  viewedAt: number;
}

function readRaw(): RecentFileEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: RecentFileEntry[] = [];
    for (const item of parsed) {
      if (item === null || typeof item !== 'object') continue;
      const e = item as Record<string, unknown>;
      const t = e['target'];
      if (
        typeof e['instanceId'] !== 'string' ||
        t === null ||
        typeof t !== 'object' ||
        typeof (t as Record<string, unknown>)['kind'] !== 'string' ||
        typeof (t as Record<string, unknown>)['path'] !== 'string' ||
        typeof (t as Record<string, unknown>)['name'] !== 'string'
      ) {
        continue;
      }
      out.push({
        instanceId: e['instanceId'],
        target: t as RecentFileTarget,
        viewedAt: typeof e['viewedAt'] === 'number' ? e['viewedAt'] : 0,
      });
    }
    return out;
  } catch {
    return [];
  }
}

function writeRaw(list: RecentFileEntry[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    // 配额满 / 隐私模式:记录是锦上添花,静默忽略
  }
}

/**
 * 记录一次文件查看
 *
 * @param limit 上限语义:<=0 不记录;-1 不限制;正数保留最近 N 条(跨实例共享
 *   同一存储,上限作用于总量)
 */
export function pushRecentFile(
  instanceId: string,
  target: RecentFileTarget,
  limit: number,
): void {
  if (!(limit > 0) && limit !== -1) return; // 0 / 负数(除 -1)= 不记录
  const list = readRaw().filter(
    (e) => !(e.instanceId === instanceId && e.target.path === target.path),
  );
  list.unshift({ instanceId, target, viewedAt: Date.now() });
  writeRaw(limit === -1 ? list : list.slice(0, limit));
}

/** 某实例的最近文件(按查看新→旧) */
export function getRecentFiles(instanceId: string): RecentFileEntry[] {
  return readRaw().filter((e) => e.instanceId === instanceId);
}

/** 清空某实例的最近文件记录(面板"清空"按钮;其它实例的记录不动) */
export function clearRecentFiles(instanceId: string): void {
  writeRaw(readRaw().filter((e) => e.instanceId !== instanceId));
}
