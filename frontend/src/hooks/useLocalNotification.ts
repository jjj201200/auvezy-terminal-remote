/**
 * useLocalNotification
 *
 * 兜底：当 Web Push 不可用（iOS Safari < 16.4），用前台 Notification API
 * 在 webapp 当前 tab 显示通知。功能弱（锁屏/后台不可达），但聊胜于无。
 *
 * 调用约定：useLocalNotification 返回一个 notify(title, body) 函数；
 * ConsolePage 在 ws 收到 status_update.waiting_input 时调用。
 *
 * 设计：
 *  - 仅在 Notification API 存在 + permission='granted' 时真正显示
 *  - 不主动申请权限：避免与 usePushNotification 的权限请求冲突
 *  - 调用方自行决定显示频率（避免重复打扰）
 */

import { useCallback } from 'react';

export function useLocalNotification(): {
  supported: boolean;
  notify: (title: string, body: string) => void;
} {
  const supported =
    typeof window !== 'undefined' &&
    'Notification' in window &&
    Notification.permission === 'granted';

  const notify = useCallback(
    (title: string, body: string): void => {
      if (!supported) return;
      try {
        new Notification(title, { body, tag: 'claude-approval' });
      } catch {
        // 部分浏览器构造函数会抛错（必须经过 SW）；静默忽略
      }
    },
    [supported],
  );

  return { supported, notify };
}
