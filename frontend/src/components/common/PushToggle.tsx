/**
 * PushToggle
 *
 * Web Push 订阅开关（设置面板"通知"分页内嵌）。
 * - 不支持时禁用 + 显示原因
 * - 已拒绝权限时显示提示，浏览器已锁，无法再触发
 * - 已订阅 / 未订阅 提供切换按钮
 *
 * 设计原则：极客风、无 emoji；状态描述靠文字 + Pill。
 */

import { type JSX } from 'react';
import { usePushNotification } from '../../hooks/usePushNotification.js';
import { Pill, type PillTone } from '../ui/Pill.js';
import { cn } from '../../utils/cn.js';

export function PushToggle(): JSX.Element {
  const { status, busy, error, subscribe, unsubscribe } = usePushNotification();

  let label: string;
  let toneText: string;
  let tone: PillTone;
  let onClick: (() => void) | null = null;
  let disabled = busy;

  switch (status) {
    case 'unsupported':
      label = '当前浏览器不支持';
      toneText = '不支持';
      tone = 'muted';
      disabled = true;
      break;
    case 'denied':
      label = '通知权限被禁，请在系统设置中开启';
      toneText = '已禁';
      tone = 'error';
      disabled = true;
      break;
    case 'subscribed':
      label = busy ? '处理中…' : '点击关闭推送';
      toneText = '已开启';
      tone = 'ok';
      onClick = () => void unsubscribe();
      break;
    case 'unsubscribed':
    default:
      label = busy ? '处理中…' : '点击开启推送';
      toneText = '未开启';
      tone = 'muted';
      onClick = () => void subscribe();
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Pill tone={tone}>{toneText}</Pill>
        <span className="text-xs text-[var(--color-fg-muted)]">
          Claude 触发审批时通过 Web Push 通知到本设备
        </span>
      </div>
      <button
        type="button"
        onClick={onClick ?? undefined}
        disabled={disabled}
        title={error ?? ''}
        className={cn(
          'self-start rounded-md border px-3 py-1.5 text-sm transition-colors',
          'border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-fg)] hover:bg-[var(--color-bg-elevated)]',
          disabled && 'opacity-40 cursor-not-allowed',
        )}
      >
        {label}
      </button>
      {error && <span className="text-xs text-[var(--color-error)]">{error}</span>}
    </div>
  );
}
