/**
 * PushToggle
 *
 * Web Push 订阅开关（设置面板"通知"分页内嵌）。
 */

import { type JSX } from 'react';
import { usePushNotification } from '../../hooks/usePushNotification.js';
import { Pill, type PillTone } from '../ui/Pill.js';
import { useT } from '../../i18n/i18n-context.js';
import s from './PushToggle.module.scss';

export function PushToggle(): JSX.Element {
  const t = useT();
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
        label = t('push.needHttpsHint');
        toneText = t('push.needHttps');
      } else {
        label = t('push.notSupportedHint');
        toneText = t('push.notSupported');
      }
      tone = 'muted';
      disabled = true;
      break;
    case 'denied':
      label = t('push.deniedHint');
      toneText = t('push.statusDenied');
      tone = 'error';
      disabled = true;
      break;
    case 'subscribed':
      label = busy ? t('push.busy') : t('push.clickToDisable');
      toneText = t('push.statusOn');
      tone = 'ok';
      onClick = () => void unsubscribe();
      break;
    case 'unsubscribed':
    default:
      label = busy ? t('push.busy') : t('push.clickToEnable');
      toneText = t('push.statusOff');
      tone = 'muted';
      onClick = () => void subscribe();
  }

  return (
    <div id="push-toggle" className={s.root}>
      <div className={s.head}>
        <Pill tone={tone}>{toneText}</Pill>
        <span className={s.headDesc}>{t('push.headDesc')}</span>
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
