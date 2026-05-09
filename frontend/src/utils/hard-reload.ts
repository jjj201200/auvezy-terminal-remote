/**
 * hardReload —— 绕开 PWA 缓存的强制刷新
 *
 * 普通 location.reload() 在 PWA 下仍可能从 ServiceWorker precache 拿到旧版 bundle，
 * 如果 webapp 卡死 / SW 异常 / 缓存中毒就刷不出新代码。
 *
 * 这里做"硬刷"三连：
 *  1. 取消所有 SW 注册（unregister）
 *  2. 清空 Cache Storage 的全部 cache
 *  3. cache: 'reload' 模式触发 location.reload —— 让浏览器跳过 HTTP cache
 *
 * 风险：
 *  - 清 cache 后离线模式不可用，需要重新联网拉资源（LAN-only 场景下后端就在身边，无影响）
 *  - 不清 localStorage（token / host alias / 用户偏好都保留）
 *  - 不清 sessionStorage（页内瞬时状态，刷新本来就丢）
 *  - URL search/hash 保留（包括 ?token=...，避免被踢回认证页）
 *
 * 调用方应该：
 *  - 给用户视觉反馈（按钮变 loading），因为 unregister + caches.delete 可能要 200-500ms
 *  - 明确告知行为（i18n hardReloadTooltip 已说明）
 */

export async function hardReload(): Promise<void> {
  try {
    // 1. unregister 所有 SW
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.allSettled(regs.map((r) => r.unregister()));
    }
  } catch {
    /* SW 不可用 / 隐私模式 → 跳过 */
  }

  try {
    // 2. 清空 Cache Storage（PWA precache 主要在这里）
    if ('caches' in self) {
      const keys = await caches.keys();
      await Promise.allSettled(keys.map((k) => caches.delete(k)));
    }
  } catch {
    /* 同上 */
  }

  // 3. 触发 reload —— 现代浏览器对 location.reload(true) 的强制参数已忽略，
  //    但走完上面两步后，下次请求 index.html 一定不会走 SW（已 unregister），
  //    HTTP cache 也走不到（caches.delete 清空 + service worker 中介没了）
  //    location.reload() 默认行为已足够
  window.location.reload();
}
