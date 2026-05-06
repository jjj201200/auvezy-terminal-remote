/**
 * NetworkSettings
 *
 * 目前只一项：自动重连次数上限。
 *
 * 设计原因：移动端无信号时浏览器重连每次都会真实产生 SYN 流量，
 * 默认 60 次（约 27 分钟封顶）平衡续航与可用性。重置后只能由用户
 * 手动点状态栏的"重连"按钮重新进入自动序列。
 */

import { useEffect, useState, type JSX } from 'react';
import {
  DEFAULT_NETWORK,
  RECONNECT_MAX_ATTEMPTS_MIN,
  RECONNECT_MAX_ATTEMPTS_MAX,
  type NetworkPrefs,
} from '@auvezy/terminal-remote-shared';
import { useT } from '../../i18n/i18n-context.js';
import s from './DisplaySettings.module.scss';

export interface NetworkSettingsProps {
  value: NetworkPrefs | undefined;
  onChange: (next: NetworkPrefs) => void;
}

export function NetworkSettings({ value, onChange }: NetworkSettingsProps): JSX.Element {
  const t = useT();
  const max = value?.reconnectMaxAttempts ?? DEFAULT_NETWORK.reconnectMaxAttempts;
  const [draft, setDraft] = useState<string>(String(max));

  useEffect(() => {
    setDraft(String(max));
  }, [max]);

  const commit = (raw: string): void => {
    if (raw === '') {
      onChange({ ...value, reconnectMaxAttempts: DEFAULT_NETWORK.reconnectMaxAttempts });
      return;
    }
    const n = Number(raw);
    if (!Number.isInteger(n)) {
      setDraft(String(max));
      return;
    }
    const clamped = Math.max(RECONNECT_MAX_ATTEMPTS_MIN, Math.min(RECONNECT_MAX_ATTEMPTS_MAX, n));
    onChange({ ...value, reconnectMaxAttempts: clamped });
  };

  return (
    <div className={s.root}>
      <section className={s.section}>
        <header className={s.sectionHeader}>
          <h3 className={s.sectionTitle}>{t('network.reconnectMaxTitle')}</h3>
          <p className={s.sectionHint}>{t('network.reconnectMaxHint')}</p>
        </header>
        <div className={s.row}>
          <input
            type="number"
            inputMode="numeric"
            min={RECONNECT_MAX_ATTEMPTS_MIN}
            max={RECONNECT_MAX_ATTEMPTS_MAX}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              if (e.target.value !== '') commit(e.target.value);
            }}
            onBlur={(e) => commit(e.target.value)}
            className={s.numInput}
            aria-label={t('network.reconnectMaxAriaLabel')}
          />
          <span className={s.valueLabel}>{t('network.reconnectMaxUnit')}</span>
        </div>
      </section>
    </div>
  );
}
