/**
 * manifest-token —— JS 端兜底,把 token 写入 <link rel="manifest"> href。
 *
 * 主路径由 broker SPA fallback / vite plugin 在 HTML 输出时就注入 token,
 * 这里仅在 webapp 内 cookie/SPA-router 切换 token 时同步前端 DOM。WebKit/Blink
 * 改 href 会触发 manifest 重新 fetch,所以**必须**幂等:同 token 重复调跳过。
 */

const MANIFEST_LINK_SELECTOR = 'link[rel="manifest"]';

export function updateManifestWithToken(token: string): void {
  if (!token) return;
  try {
    const link = document.querySelector<HTMLLinkElement>(MANIFEST_LINK_SELECTOR);
    if (!link) return;
    const url = new URL(link.href, window.location.origin);
    if (url.searchParams.get('token') === token) return;
    url.searchParams.set('token', token);
    link.setAttribute('href', url.pathname + url.search);
  } catch {
    // DOM 不可用 / 解析失败:静默——PWA 不带 token 是退化行为,不应阻塞登录
  }
}
