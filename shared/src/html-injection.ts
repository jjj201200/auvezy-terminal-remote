/**
 * HTML 注入工具(纯函数,backend / vite plugin / 测试共用)
 *
 * 之所以放 shared:backend SPA fallback 与 vite plugin transformIndexHtml 都要
 * 给 manifest link 拼 token,实现必须**一致**,否则 dev / prod 行为分裂(实测
 * 早期版本两边正则不同,dev 把 href 写在 rel 之前时静默不生效)。
 */

/**
 * 把 token 拼到 index.html 里 <link rel="manifest"> 的 href 后面。
 *
 * - 匹配 rel 与 href 任意顺序的 <link> 标签
 * - 已有 query 时用 & 追加,否则用 ?
 * - 找不到 manifest link 或 href 属性时原样返回(降级而非抛错,不阻塞 SPA 加载)
 */
export function injectManifestToken(html: string, token: string): string {
  if (!token) return html;
  const linkRe = /<link\b[^>]*\brel=["']manifest["'][^>]*>/i;
  const match = html.match(linkRe);
  if (!match) return html;
  const tag = match[0];
  const hrefRe = /\bhref=("([^"]*)"|'([^']*)')/i;
  const hm = tag.match(hrefRe);
  if (!hm) return html;
  const oldHref = hm[2] ?? hm[3] ?? '';
  const sep = oldHref.includes('?') ? '&' : '?';
  const newHref = `${oldHref}${sep}token=${encodeURIComponent(token)}`;
  const newTag = tag.replace(hrefRe, `href="${newHref}"`);
  return html.replace(tag, newTag);
}
