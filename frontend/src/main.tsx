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

// 移动端调试浮层（eruda）：默认关闭，可在「设置 → 开发」里打开。
// 也支持 ?eruda=1 临时开启（不写入 localStorage）
// iOS 上没法用 chrome://inspect 也没法连 macOS Safari 时，靠它看 console
const ERUDA_KEY = 'atr.devtools.eruda';
const erudaQuery = new URLSearchParams(location.search).get('eruda');
const erudaEnabled = erudaQuery === '1' || localStorage.getItem(ERUDA_KEY) === '1';
if (erudaEnabled) {
  void import('eruda').then(({ default: eruda }) => eruda.init());
}

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
