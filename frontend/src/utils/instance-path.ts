/**
 * SPA 内部路由 helper：解析 / 构造 `/i/<instanceId>/` 路径
 *
 * 0.7.0 起 broker 反代时 URL 形态：
 *   `/i/<instanceId>/...`  —— 当前激活实例
 *   `/`                    —— 默认入口（broker 自身根，进入后 SPA 自动选 isCurrent）
 *
 * SPA 切实例 = `history.pushState(null, '', '/i/<targetId>/')`，浏览器不刷新；
 * popstate 监听 URL 变化 → 同步 activeId 状态。
 */

const INSTANCE_PATH_RE = /^\/i\/([^/]+)(\/|$)/;

/**
 * 从给定 path（默认当前 location.pathname）提取 instanceId
 *
 * @returns instanceId；找不到（路径不以 `/i/<id>` 起头）→ null
 *
 * @example
 * getInstanceIdFromPath('/i/abc-123/')             === 'abc-123'
 * getInstanceIdFromPath('/i/abc-123/api/foo')      === 'abc-123'
 * getInstanceIdFromPath('/')                       === null
 * getInstanceIdFromPath('/some/other/path')        === null
 */
export function getInstanceIdFromPath(path?: string): string | null {
  const p = path ?? (typeof window !== 'undefined' ? window.location.pathname : '/');
  const m = p.match(INSTANCE_PATH_RE);
  return m ? (m[1] ?? null) : null;
}

/** 构造 `/i/<id>/` 形式的路径（带尾斜杠，用于 pushState 与 base href） */
export function buildInstancePath(instanceId: string): string {
  return `/i/${instanceId}/`;
}

/**
 * 切实例：history.pushState 改 URL，**不**触发页面刷新
 *
 * 调用方仍要自己 `setActiveId(targetId)` 改 React state；本函数仅负责 URL。
 * 故意拆开两步——pushState 是浏览器副作用，setActiveId 是渲染状态，让调用方
 * 一并控制（也方便测试 mock）。
 */
export function pushInstancePath(instanceId: string): void {
  if (typeof window === 'undefined') return;
  const targetPath = buildInstancePath(instanceId);
  if (window.location.pathname === targetPath) return; // 同 URL 不重复推
  window.history.pushState(null, '', targetPath);
}
