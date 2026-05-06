/**
 * DevSettings
 *
 * 开发者选项。仅本设备生效（写 localStorage，不上传后端 UserConfig）。
 * 切换后需刷新页面才能生效（开关在 main.tsx 启动时被读取）。
 */

import { useState, type JSX } from 'react';
import { Toggle } from '../ui/Toggle.js';
import { useT } from '../../i18n/i18n-context.js';
import s from './GeneralSettings.module.scss';

const ERUDA_KEY = 'atr.devtools.eruda';
const CONSOLE_BRIDGE_KEY = 'atr.devtools.consoleBridge';

export function DevSettings(): JSX.Element {
  const t = useT();
  const [eruda, setEruda] = useState<boolean>(
    () => typeof localStorage !== 'undefined' && localStorage.getItem(ERUDA_KEY) === '1',
  );
  const [bridge, setBridge] = useState<boolean>(
    () => typeof localStorage !== 'undefined' && localStorage.getItem(CONSOLE_BRIDGE_KEY) === '1',
  );

  return (
    <div className={s.root}>
      <section className={s.section}>
        <header className={s.header}>
          <h3 className={s.title}>{t('dev.erudaTitle')}</h3>
          <p className={s.hint}>{t('dev.erudaHint')}</p>
        </header>
        <Toggle
          checked={eruda}
          onCheckedChange={(next) => {
            setEruda(next);
            if (next) localStorage.setItem(ERUDA_KEY, '1');
            else localStorage.removeItem(ERUDA_KEY);
          }}
          label={eruda ? t('dev.erudaToggleOn') : t('dev.erudaToggleOff')}
        />
      </section>

      <section className={s.section}>
        <header className={s.header}>
          <h3 className={s.title}>{t('dev.consoleBridgeTitle')}</h3>
          <p className={s.hint}>{t('dev.consoleBridgeHint')}</p>
        </header>
        <Toggle
          checked={bridge}
          onCheckedChange={(next) => {
            setBridge(next);
            if (next) localStorage.setItem(CONSOLE_BRIDGE_KEY, '1');
            else localStorage.removeItem(CONSOLE_BRIDGE_KEY);
          }}
          label={bridge ? t('dev.consoleBridgeOn') : t('dev.consoleBridgeOff')}
        />
      </section>
    </div>
  );
}
