/**
 * PWA service worker 注册 + 更新检测
 *
 * 行为：
 *  - 仅 production 注册（vite-plugin-pwa 的 dev 模式跟 HMR 冲突）
 *  - 注册成功后定时检查更新（5 分钟一次）
 *  - 检测到新版本：触发 onUpdate 回调，让 UI 弹"有新版本，点击刷新"
 *  - 调 applyUpdate() 后：postMessage SKIP_WAITING → 新 SW 接管 → 自动 reload
 */

const SW_PATH = '/sw.js'; // vite-plugin-pwa injectManifest 模式默认输出名
const UPDATE_CHECK_INTERVAL_MS = 5 * 60 * 1000;

export interface RegisterOptions {
  onUpdateAvailable: (applyUpdate: () => void) => void;
}

export function registerServiceWorker(opts: RegisterOptions): void {
  if (typeof window === 'undefined') return;
  if (!('serviceWorker' in navigator)) return;
  if (import.meta.env.DEV) {
    // dev 模式：主动 unregister 所有 SW + 清缓存，避免上一次 prod build 留下的
    // SW 拦截 dev 请求返回缓存（导致 HMR 不生效 / 改动看不到）
    void (async () => {
      const all = await navigator.serviceWorker.getRegistrations();
      await Promise.all(all.map((r) => r.unregister()));
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
    })();
    return;
  }

  window.addEventListener('load', () => {
    void (async () => {
      try {
        // 一次性清理旧 SW（v0.3 之前路径是 /service-worker.js）。
        // 新版统一改用 /sw.js（vite-plugin-pwa 输出）。
        // navigator.serviceWorker.getRegistrations 拿到全部已注册 SW，过滤旧路径 unregister。
        const all = await navigator.serviceWorker.getRegistrations();
        await Promise.all(
          all
            .filter((r) => r.active?.scriptURL.endsWith('/service-worker.js'))
            .map((r) => r.unregister()),
        );

        const reg = await navigator.serviceWorker.register(SW_PATH, { scope: '/' });

        // 定时主动检查更新
        setInterval(() => {
          void reg.update().catch(() => {
            /* 网络错误：下一次再试 */
          });
        }, UPDATE_CHECK_INTERVAL_MS);

        // 监听 waiting：有新 SW 装好但还没接管 → 提示用户
        const notifyIfWaiting = (): void => {
          if (!reg.waiting) return;
          const waiting = reg.waiting;
          opts.onUpdateAvailable(() => {
            // 新 SW 接管后页面会触发 controllerchange → 我们 reload
            waiting.postMessage({ type: 'SKIP_WAITING' });
          });
        };

        // 已经有 waiting（用户上次没点更新就关了）
        notifyIfWaiting();
        // 后续装好新版本时
        reg.addEventListener('updatefound', () => {
          const installing = reg.installing;
          if (!installing) return;
          installing.addEventListener('statechange', () => {
            if (installing.state === 'installed' && navigator.serviceWorker.controller) {
              notifyIfWaiting();
            }
          });
        });

        // 新 SW 接管：reload 拿到新版本资源
        let reloading = false;
        navigator.serviceWorker.addEventListener('controllerchange', () => {
          if (reloading) return;
          reloading = true;
          window.location.reload();
        });
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[pwa] SW 注册失败', err);
      }
    })();
  });
}
