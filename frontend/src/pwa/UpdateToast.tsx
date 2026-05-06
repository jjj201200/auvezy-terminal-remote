/**
 * UpdateToast
 *
 * 检测到 SW 有新版本时浮在右下角的提示条：
 *   "新版本已就绪 · 立即更新"
 * 点击触发 applyUpdate（postMessage SKIP_WAITING → controllerchange → reload）。
 */

import { useEffect, useState, type JSX } from 'react';
import { registerServiceWorker } from './register-sw.js';
import { useT } from '../i18n/i18n-context.js';
import s from './UpdateToast.module.scss';

export function UpdateToast(): JSX.Element | null {
  const t = useT();
  const [apply, setApply] = useState<(() => void) | null>(null);

  useEffect(() => {
    registerServiceWorker({
      onUpdateAvailable: (applyUpdate) => {
        setApply(() => applyUpdate);
      },
    });
  }, []);

  if (!apply) return null;

  return (
    <div className={s.root} role="status" aria-live="polite">
      <span className={s.text}>{t('pwa.updateReady')}</span>
      <button type="button" onClick={apply} className={s.btn}>
        {t('pwa.updateApply')}
      </button>
      <button
        type="button"
        onClick={() => setApply(null)}
        className={s.dismiss}
        aria-label={t('common.close')}
      >
        ×
      </button>
    </div>
  );
}
