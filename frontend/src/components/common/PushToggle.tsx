/**
 * PushToggle
 *
 * Web Push 订阅开关（设置面板"通知"分页内嵌）。
 */

import { type JSX } from 'react';
import { usePushNotification } from '../../hooks/usePushNotification.js';
import { Pill, type PillTone } from '../ui/Pill.js';
import s from './PushToggle.module.scss';

export function PushToggle(): JSX.Element {
  const { status, unsupportReason, busy, error, subscribe, unsubscribe } =
    usePushNotification();

  let label: string;
  let toneText: string;
  let tone: PillTone;
  let onClick: (() => void) | null = null;
  let disabled = busy;

  switch (status) {
    case 'unsupported':
      // 不再笼统报"不支持"——细分到可执行的引导
      if (unsupportReason === 'insecure_context') {
        label = '当前是 HTTP 连接，浏览器禁用 Web Push；请用 HTTPS 或 localhost 访问';
        toneText = '需 HTTPS';
      } else {
        label = '当前浏览器缺少 ServiceWorker / PushManager API';
        toneText = '不支持';
      }
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
    <div id="push-toggle" className={s.root}>
      <div className={s.head}>
        <Pill tone={tone}>{toneText}</Pill>
        <span className={s.headDesc}>Claude 触发审批时通过 Web Push 通知到本设备</span>
      </div>
      <button
        type="button"
        onClick={onClick ?? undefined}
        disabled={disabled}
        title={error ?? ''}
        className={s.btn}
      >
        {label}
      </button>
      {error && <span className={s.error}>{error}</span>}
    </div>
  );
}
