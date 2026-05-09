/**
 * Host registry（localStorage 持久化）
 *
 * 0.6.0 升级：从单纯的 alias map 升级为完整 registry。每条记录除 alias 外
 * 还存 host 字符串本身（用作分组 key）和 addedAt（排序）。
 *
 * 旧 schema 兼容：之前 localStorage key 'atr.host_aliases' 存的是
 * { [host]: alias } 的 plain map；读取时如果识别到该形式 → 自动迁移到新 schema。
 *
 * 持久化结构（storage key 'atr.host_registry'）：
 *   {
 *     version: 1,
 *     hosts: [
 *       { host: '192.168.1.5', alias: '我的台式机', addedAt: '...' },
 *       { host: '100.104.50.64', alias: 'Tailscale 笔记本', addedAt: '...' }
 *     ]
 *   }
 *
 * 设计：
 *  - host 是唯一 key（不允许两条记录同 host）
 *  - alias 必填（重命名约束："不能为空"），等同于显示名；登记时不传 alias 时
 *    自动用 host 作为 alias（之后用户可改）
 *  - 不存 token / port —— 安全风险且非必要（跳转 URL 自己带 token）
 *  - 跨 origin localStorage 不共享 —— 这是浏览器限制，本服务在每个 origin
 *    独立维护一份注册表
 */

const NEW_KEY = 'atr.host_registry';
const OLD_KEY = 'atr.host_aliases';

export interface HostEntry {
  host: string;
  alias: string;
  /** ISO 8601 字符串 */
  addedAt: string;
}

interface RegistryV1 {
  version: 1;
  hosts: HostEntry[];
}

/** 读全部 entry；自动从老 schema 迁移 */
export function loadHostRegistry(): HostEntry[] {
  try {
    // 优先读新 key
    const raw = window.localStorage.getItem(NEW_KEY);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (
        parsed &&
        typeof parsed === 'object' &&
        (parsed as RegistryV1).version === 1 &&
        Array.isArray((parsed as RegistryV1).hosts)
      ) {
        return ((parsed as RegistryV1).hosts as HostEntry[])
          .filter(
            (h) =>
              h &&
              typeof h.host === 'string' &&
              h.host.length > 0 &&
              typeof h.alias === 'string',
          )
          .map((h) => ({
            host: h.host,
            alias: h.alias,
            addedAt: typeof h.addedAt === 'string' ? h.addedAt : new Date().toISOString(),
          }));
      }
    }

    // fallback：读老 alias map 并迁移
    const oldRaw = window.localStorage.getItem(OLD_KEY);
    if (oldRaw) {
      const parsed: unknown = JSON.parse(oldRaw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const out: HostEntry[] = [];
        for (const [host, alias] of Object.entries(parsed)) {
          if (typeof host === 'string' && typeof alias === 'string' && host.length > 0) {
            out.push({ host, alias, addedAt: new Date().toISOString() });
          }
        }
        // 写入新 key（迁移成功）；老 key 暂不删，等下个版本再清理
        if (out.length > 0) {
          saveHostRegistry(out);
        }
        return out;
      }
    }
  } catch {
    /* localStorage 不可用 / JSON 损坏 → 视为空 */
  }
  return [];
}

/** 写全套 registry */
function saveHostRegistry(hosts: HostEntry[]): void {
  try {
    const payload: RegistryV1 = { version: 1, hosts };
    window.localStorage.setItem(NEW_KEY, JSON.stringify(payload));
  } catch {
    /* 容量满 / 隐私模式 → 静默失败 */
  }
}

/**
 * 登记 / 更新一条 host 记录。
 *
 * - host 已存在 → 更新 alias
 * - host 不存在 → 追加；addedAt 自动取当前时间
 * - alias 空字符串 → 抛错（约束："不能为空"）
 */
export function upsertHost(host: string, alias: string): void {
  const a = alias.trim();
  if (a.length === 0) {
    throw new Error('alias 不能为空');
  }
  const list = loadHostRegistry();
  const existing = list.find((h) => h.host === host);
  if (existing) {
    existing.alias = a;
  } else {
    list.push({ host, alias: a, addedAt: new Date().toISOString() });
  }
  saveHostRegistry(list);
}

/** 删除一条 host */
export function removeHost(host: string): void {
  const list = loadHostRegistry().filter((h) => h.host !== host);
  saveHostRegistry(list);
}

/** 拿单条 entry；不存在返回 undefined */
export function getHostEntry(host: string): HostEntry | undefined {
  return loadHostRegistry().find((h) => h.host === host);
}

// ─────────────────────────── 向后兼容旧 API ───────────────────────────
//
// 之前其它代码用过 loadHostAliases / setHostAlias / getHostAlias —— 保留这些
// 名字防止编译失败，内部转调新 API

export type HostAliases = Record<string, string>;

export function loadHostAliases(): HostAliases {
  const out: HostAliases = {};
  for (const h of loadHostRegistry()) {
    out[h.host] = h.alias;
  }
  return out;
}

export function setHostAlias(host: string, alias: string): void {
  const trimmed = alias.trim();
  if (trimmed.length === 0) {
    // 旧 API 允许空 → 等同于删除 host 记录
    removeHost(host);
    return;
  }
  upsertHost(host, trimmed);
}

export function getHostAlias(host: string): string | undefined {
  return getHostEntry(host)?.alias;
}
