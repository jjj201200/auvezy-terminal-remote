/**
 * InstallPrompt
 *
 * 浏览器触发 beforeinstallprompt 时拦截事件，显示自定义"添加到主屏"按钮。
 * 用户点击后调原生 prompt() 弹安装对话框。
 *
 * 仅 Chrome / Edge / 三星浏览器等支持 beforeinstallprompt 的环境会出现按钮。
 * iOS Safari 没有此事件——用户需手动从分享菜单"添加到主屏幕"，无法编程触发。
 */

import { useEffect, useState, type JSX } from 'react';
import { useT } from '../i18n/i18n-context.js';
import s from './InstallPrompt.module.scss';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const DISMISS_KEY = 'otr.installPromptDismissedUntil';
// 用户点过"以后再说"后，至少 7 天不再展示
const DISMISS_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function InstallPrompt(): JSX.Element | null {
  const t = useT();
  const [evt, setEvt] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    const dismissedUntil = Number(localStorage.getItem(DISMISS_KEY) ?? 0);
    if (Date.now() < dismissedUntil) return;

    // 已经是 standalone 模式（用户已装）：不再提示
    if (window.matchMedia('(display-mode: standalone)').matches) return;

    const handler = (e: Event): void => {
      e.preventDefault();
      setEvt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  if (!evt) return null;

  const dismiss = (): void => {
    localStorage.setItem(DISMISS_KEY, String(Date.now() + DISMISS_TTL_MS));
    setEvt(null);
  };

  const install = async (): Promise<void> => {
    await evt.prompt();
    await evt.userChoice;
    setEvt(null);
  };

  return (
    <div className={s.root} role="dialog" aria-label={t('pwa.installTitle')}>
      <div className={s.content}>
        <div className={s.title}>{t('pwa.installTitle')}</div>
        <div className={s.body}>{t('pwa.installBody')}</div>
      </div>
      <button type="button" onClick={() => void install()} className={s.btn}>
        {t('pwa.installAction')}
      </button>
      <button
        type="button"
        onClick={dismiss}
        className={s.dismiss}
        aria-label={t('common.close')}
      >
        ×
      </button>
    </div>
  );
}
