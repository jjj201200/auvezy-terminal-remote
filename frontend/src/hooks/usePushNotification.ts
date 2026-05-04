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
  /** 操作进行中（订阅 / 取消订阅） */
  busy: boolean;
  /** 上次错误信息 */
  error: string | null;
  /** 触发订阅 */
  subscribe: () => Promise<void>;
  /** 取消订阅 */
  unsubscribe: () => Promise<void>;
}

function isPushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
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
  const [status, setStatus] = useState<PushSupportStatus>(() =>
    isPushSupported() ? 'unsubscribed' : 'unsupported',
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 挂载后检查现有订阅状态
  useEffect(() => {
    if (!isPushSupported()) return;
    (async (): Promise<void> => {
      try {
        const reg = await navigator.serviceWorker.register('/service-worker.js');
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

  return { status, busy, error, subscribe, unsubscribe };
}
