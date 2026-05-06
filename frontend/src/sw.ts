/// <reference lib="webworker" />
/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Service Worker（vite-plugin-pwa injectManifest 模式）
 *
 * 一身二职：
 *  1. 离线 / 资源缓存（Workbox 预缓存 + 运行时策略）
 *  2. Web Push 通知（接管之前 public/service-worker.js 的事件）
 *
 * 缓存策略：
 *  - 预缓存：build 出的所有静态资源（self.__WB_MANIFEST 由 vite-plugin-pwa 注入）
 *  - /api/* 与 /ws：永不缓存（网络优先，离线时让请求自然失败）
 *  - 其它同源 GET：StaleWhileRevalidate（先返缓存，后台拉新版替换）
 */

import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { StaleWhileRevalidate } from 'workbox-strategies';

declare let self: ServiceWorkerGlobalScope & { __WB_MANIFEST: Array<{ url: string; revision: string | null }> };

// ─────────────── 预缓存：所有 build 出的静态资源 ───────────────
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

// ─────────────── 运行时缓存：同源静态资源（图片 / 字体等） ───────────────
// API / WS 不缓存：路由匹配里直接排除，让请求走网络，断网即失败由 UI 提示
registerRoute(
  ({ url, request }) => {
    if (url.origin !== self.location.origin) return false;
    if (url.pathname.startsWith('/api/')) return false;
    if (url.pathname.startsWith('/ws')) return false;
    return request.method === 'GET';
  },
  new StaleWhileRevalidate({ cacheName: 'otr-runtime' }),
);

// ─────────────── 生命周期 ───────────────
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// 让前端能通过 postMessage 触发立即更新
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// ─────────────── Web Push ───────────────
self.addEventListener('push', (event: PushEvent) => {
  let payload: { title?: string; body?: string; url?: string } = {
    title: 'Open Terminal Remote',
    body: '收到新通知',
  };
  try {
    if (event.data) {
      payload = { ...payload, ...event.data.json() };
    }
  } catch {
    /* 非 JSON：用默认 */
  }

  event.waitUntil(
    self.registration.showNotification(payload.title ?? 'OTR', {
      body: payload.body ?? '',
      tag: 'claude-approval',
      renotify: true,
      data: { url: payload.url ?? '/' },
    } as NotificationOptions),
  );
});

self.addEventListener('notificationclick', (event: NotificationEvent) => {
  event.notification.close();
  const data = event.notification.data as { url?: string } | undefined;
  const targetUrl = data?.url ?? '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const c of clients) {
        try {
          (c as WindowClient).focus();
          if ('navigate' in c) (c as WindowClient).navigate(targetUrl);
          return;
        } catch {
          /* 忽略：尝试下一个 client */
        }
      }
      return self.clients.openWindow(targetUrl);
    }),
  );
});
