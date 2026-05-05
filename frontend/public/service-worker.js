/**
 * Web Push Service Worker
 *
 * 注册路径：/service-worker.js（root scope）
 *
 * 工作流：
 *   1. 浏览器加载 /service-worker.js → register
 *   2. 通过 PushManager.subscribe(VAPID 公钥) 拿到 PushSubscription
 *   3. 把订阅信息 POST 到 /api/push/subscriptions
 *   4. 服务端 sendNotification → 浏览器调用本 SW 的 'push' 事件
 *   5. SW 弹 system notification（锁屏可达）
 *
 * 这里只负责 (4)(5) 步。订阅由 hooks/usePushNotification 触发。
 *
 * 注意：SW 在独立 worker context 跑，不能 import npm 模块；
 * 用纯 JS（不走 TS）。
 */

self.addEventListener('install', () => {
  // 立即激活，不等老 SW 完成
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let payload = { title: 'Open Terminal Remote', body: '收到新通知' };
  try {
    if (event.data) {
      payload = { ...payload, ...event.data.json() };
    }
  } catch {
    // payload 不是 JSON：回退默认
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      // icon / badge 故意不设：未提供时浏览器用默认 + 站点 favicon
      tag: 'claude-approval',
      // 让通知不被同 tag 覆盖（默认会被覆盖；这里允许覆盖以避免堆积）
      renotify: true,
      data: { url: payload.url ?? '/' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url ?? '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      // 已有同 origin tab → focus；否则 openWindow
      for (const c of clients) {
        try {
          c.focus();
          if ('navigate' in c) c.navigate(targetUrl);
          return;
        } catch {
          /* */
        }
      }
      return self.clients.openWindow(targetUrl);
    }),
  );
});
