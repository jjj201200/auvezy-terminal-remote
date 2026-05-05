/**
 * IpChangeToast
 *
 * 屏幕底部黄色横条，IP 漂移时提示用户。
 * 不自动消失；手动 dismiss 或点"复制链接"。
 *
 * 位置上移到 InputBar 之上（避免压输入栏）。
 */

import { useState, type JSX } from 'react';
import { useT } from '../../i18n/i18n-context.js';
import s from './IpChangeToast.module.scss';

export interface IpChangeInfo {
  oldIp: string;
  newIp: string;
  /** 服务端可选地附带新 URL；前端没有 token 用这个 */
  newUrl?: string;
}

export interface IpChangeToastProps {
  info: IpChangeInfo | null;
  onDismiss: () => void;
}

export function IpChangeToast({ info, onDismiss }: IpChangeToastProps): JSX.Element | null {
  const t = useT();
  const [copied, setCopied] = useState(false);
  if (!info) return null;

  const target = info.newUrl ?? `http://${info.newIp}/`;

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(target);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div id="ip-change-toast" role="alert" aria-live="polite" className={s.root}>
      <div className={s.body}>
        <span className={s.title}>{t('ipChange.title')}</span>
        <span className={s.ips}>
          {info.oldIp} → <strong>{info.newIp}</strong>
        </span>
        <span className={s.url}>{target}</span>
      </div>
      <div className={s.actions}>
        <button type="button" onClick={() => void copy()} className={s.actionBtn}>
          {copied ? t('ipChange.copied') : t('ipChange.copy')}
        </button>
        <button type="button" onClick={onDismiss} className={s.actionBtn}>
          {t('ipChange.dismiss')}
        </button>
      </div>
    </div>
  );
}
