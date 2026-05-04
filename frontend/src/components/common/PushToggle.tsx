/**
 * PushToggle
 *
 * Web Push 订阅开关（小按钮）。
 * - 不支持时显示禁用 + 提示文案
 * - 已拒绝权限时只显示提示，不能再次触发（浏览器已锁）
 * - 未订阅时按钮文案"开启推送"
 * - 已订阅时按钮文案"关闭推送"
 */

import { type JSX } from 'react';
import { usePushNotification } from '../../hooks/usePushNotification.js';

export function PushToggle(): JSX.Element {
  const { status, busy, error, subscribe, unsubscribe } = usePushNotification();

  let label: string;
  let onClick: (() => void) | null = null;
  let disabled = busy;
  switch (status) {
    case 'unsupported':
      label = '推送不支持';
      disabled = true;
      break;
    case 'denied':
      label = '推送被禁（请在系统设置中开启）';
      disabled = true;
      break;
    case 'subscribed':
      label = busy ? '处理中…' : '关闭推送';
      onClick = () => void unsubscribe();
      break;
    case 'unsubscribed':
    default:
      label = busy ? '处理中…' : '开启推送';
      onClick = () => void subscribe();
  }

  return (
    <div className="push-toggle">
      <button
        type="button"
        className="push-toggle__btn"
        onClick={onClick ?? undefined}
        disabled={disabled}
        title={error ?? ''}
      >
        🔔 {label}
      </button>
      {error && <span className="push-toggle__error">{error}</span>}
    </div>
  );
}
