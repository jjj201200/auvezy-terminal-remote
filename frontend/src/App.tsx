/**
 * App 根组件
 *
 * 阶段 2：根据认证状态切换 AuthPage / ConsolePage
 *  - pending: 显示加载占位（防止 AuthPage 闪现后又跳走）
 *  - unauthenticated: AuthPage
 *  - authenticated: ConsolePage
 *
 * viewport fix 在根组件挂一次即生效全局。
 */

import type { JSX } from 'react';
import { useAuth } from './hooks/useAuth.js';
import { useViewportFix } from './hooks/useViewportFix.js';
import { AuthPage } from './pages/AuthPage.js';
import { ConsolePage } from './pages/ConsolePage.js';

export function App(): JSX.Element {
  useViewportFix();
  const { status, login } = useAuth();

  if (status === 'pending') {
    return (
      <div className="flex flex-1 items-center justify-center text-[var(--color-fg-muted)] font-mono">
        <span>加载中…</span>
      </div>
    );
  }

  if (status === 'unauthenticated') {
    return <AuthPage onLogin={login} />;
  }

  return <ConsolePage />;
}
