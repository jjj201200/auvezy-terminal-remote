/**
 * usePushNotification
 *
 * 负责：
 *  - 检测浏览器对 ServiceWorker + PushManager + Notification 的支持
 *  - 注册 service-worker.js
 *  - 申请通知权限
 *  - 用 VAPID 公钥订阅 → POST /api/push/subscriptions
 *  - 取消订阅 → DELETE
 *
 * 不做的事：
 *  - 自动订阅：由用户在 ConsolePage 上点按钮触发，避免侵入式权限弹窗
 */

import { useCallback, useEffect, useState } from 'react';
import { fetchVapidPublicKey, postSubscription, deleteSubscription } from '../services/push-api.js';

export type PushSupportStatus =
  | 'unsupported' // 浏览器不支持（iOS Safari 旧版等）
  | 'denied' // 用户已拒绝权限
  | 'unsubscribed' // 支持且未订阅
  | 'subscribed'; // 已订阅

export interface UsePushNotificationResult {
  status: PushSupportStatus;
  /** status='unsupported' 时的具体原因；其它状态固定为 'none' */
  unsupportReason: PushUnsupportReason;
  /** 操作进行中（订阅 / 取消订阅） */
  busy: boolean;
  /** 上次错误信息 */
  error: string | null;
  /** 触发订阅 */
  subscribe: () => Promise<void>;
  /** 取消订阅 */
  unsubscribe: () => Promise<void>;
}

/**
 * 不支持 Web Push 的具体原因
 *
 * 用于分级提示——把"不支持"细分成可执行的引导：
 *  - insecure_context：当前不是 HTTPS 也不是 localhost/file://
 *    Chrome/Safari/Firefox 都强制 secure context 才允许 ServiceWorker + Push
 *    LAN HTTP（http://192.168.x.x）一定会走到这里
 *  - missing_api：浏览器实在没实现（罕见，例如 iOS 16.4 之前）
 *  - none：完全支持
 */
export type PushUnsupportReason = 'none' | 'insecure_context' | 'missing_api';

export function detectPushSupport(): PushUnsupportReason {
  if (typeof window === 'undefined') return 'missing_api';
  // 必须 secure context（HTTPS / localhost / 127.0.0.1 / file://）
  // window.isSecureContext 是浏览器判定结果，包含 localhost 自动豁免
  if (!window.isSecureContext) return 'insecure_context';
  if (
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  ) {
    return 'none';
  }
  return 'missing_api';
}

function isPushSupported(): boolean {
  return detectPushSupport() === 'none';
}

/** base64url → ArrayBuffer（VAPID 公钥订阅入参，避免 SharedArrayBuffer 兼容问题） */
function urlBase64ToBuffer(s: string): ArrayBuffer {
  const padding = '='.repeat((4 - (s.length % 4)) % 4);
  const base64 = (s + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const buf = new ArrayBuffer(raw.length);
  const view = new Uint8Array(buf);
  for (let i = 0; i < raw.length; i++) view[i] = raw.charCodeAt(i);
  return buf;
}

/** 把 PushSubscription.toJSON() 的 keys 字段转成 string */
function readKeys(sub: PushSubscription): { p256dh: string; auth: string } | null {
  const json = sub.toJSON();
  if (
    typeof json.keys?.p256dh === 'string' &&
    typeof json.keys?.auth === 'string'
  ) {
    return { p256dh: json.keys.p256dh, auth: json.keys.auth };
  }
  return null;
}

export function usePushNotification(): UsePushNotificationResult {
  const [unsupportReason] = useState<PushUnsupportReason>(() => detectPushSupport());
  const [status, setStatus] = useState<PushSupportStatus>(() =>
    unsupportReason === 'none' ? 'unsubscribed' : 'unsupported',
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 挂载后检查现有订阅状态
  useEffect(() => {
    if (!isPushSupported()) return;
    (async (): Promise<void> => {
      try {
        // SW 现在由 src/pwa/register-sw.ts 统一注册，这里只取已 ready 的 registration
        const reg = await navigator.serviceWorker.ready;
        const existing = await reg.pushManager.getSubscription();
        const perm = Notification.permission;
        if (perm === 'denied') setStatus('denied');
        else if (existing) setStatus('subscribed');
        else setStatus('unsubscribed');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Service Worker 注册失败');
      }
    })();
  }, []);

  const subscribe = useCallback(async (): Promise<void> => {
    if (!isPushSupported()) return;
    setBusy(true);
    setError(null);
    try {
      const reg = await navigator.serviceWorker.ready;
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') {
        setStatus('denied');
        return;
      }
      const r = await fetchVapidPublicKey();
      if (!r.ok || !r.data?.publicKey) {
        setError(r.error?.message ?? '获取 VAPID 失败');
        return;
      }
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToBuffer(r.data.publicKey),
      });
      const keys = readKeys(sub);
      if (!keys) {
        setError('订阅缺少 keys 字段');
        return;
      }
      const post = await postSubscription({ endpoint: sub.endpoint, keys });
      if (!post.ok) {
        setError(post.error?.message ?? '保存订阅失败');
        // 服务端失败时也撤销浏览器订阅，避免悬挂
        await sub.unsubscribe().catch(() => {});
        return;
      }
      setStatus('subscribed');
    } catch (err) {
      setError(err instanceof Error ? err.message : '订阅失败');
    } finally {
      setBusy(false);
    }
  }, []);

  const unsubscribe = useCallback(async (): Promise<void> => {
    if (!isPushSupported()) return;
    setBusy(true);
    setError(null);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await deleteSubscription(sub.endpoint);
        await sub.unsubscribe();
      }
      setStatus('unsubscribed');
    } catch (err) {
      setError(err instanceof Error ? err.message : '取消订阅失败');
    } finally {
      setBusy(false);
    }
  }, []);

  return { status, unsupportReason, busy, error, subscribe, unsubscribe };
}
