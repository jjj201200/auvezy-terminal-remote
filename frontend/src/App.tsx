/**
 * App 根组件
 *
 * 阶段 2：根据认证状态切换 AuthPage / ConsolePage
 *  - pending: 显示加载占位（防止 AuthPage 闪现后又跳走）
 *  - unauthenticated: AuthPage
 *  - authenticated: ConsolePage
 */

import type { JSX } from 'react';
import { useAuth } from './hooks/useAuth.js';
import { useViewportFix } from './hooks/useViewportFix.js';
import { useT } from './i18n/i18n-context.js';
import { AuthPage } from './pages/AuthPage.js';
import { MultiInstanceConsole } from './pages/MultiInstanceConsole.js';
import { UpdateToast } from './pwa/UpdateToast.js';
import { InstallPrompt } from './pwa/InstallPrompt.js';
import s from './App.module.scss';

export function App(): JSX.Element {
  useViewportFix();
  const { status, login } = useAuth();
  const t = useT();

  if (status === 'pending') {
    return (
      <div id="app-loading" className={s.loading}>
        <span className={s.loadingText}>{t('app.loading')}</span>
        <span className={s.loadingDot} />
      </div>
    );
  }

  return (
    <>
      {status === 'unauthenticated' ? <AuthPage onLogin={login} /> : <MultiInstanceConsole />}
      <UpdateToast />
      <InstallPrompt />
    </>
  );
}
