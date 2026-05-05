/**
 * 前端入口
 *
 * 挂载 React 树到 #app，仅做装载工作。
 * 所有业务逻辑都在 App 与子组件中。
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { I18nProvider } from './i18n/i18n-context.js';
import './styles/global.scss';

const container = document.getElementById('app');
if (!container) {
  throw new Error('找不到 #app 容器，index.html 是否正确加载？');
}

createRoot(container).render(
  <StrictMode>
    <I18nProvider>
      <App />
    </I18nProvider>
  </StrictMode>,
);
