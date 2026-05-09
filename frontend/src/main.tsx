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
import { ConfirmProvider } from './components/ui/ConfirmProvider.js';
import { ModalStackProvider } from './components/ui/modal-stack/ModalStack.js';
import './styles/global.scss';

// 移动端调试：eruda（屏幕浮层）+ console-bridge（转发到 backend）
// 都默认关闭，可在「设置 → 开发」里打开（也支持 ?eruda=1 / ?consolebridge=1）
//
// 顺序很重要：必须先 eruda init 后 install bridge。两者都通过 `console[lv] = ...`
// 拦截输出，后 install 的会覆盖前一个。bridge 在外层（最后 install），它的封装
// 内部调用 orig（eruda 的封装）→ orig 又调用真正的 console 原函数，eruda 仍能
// 看到所有日志。反过来 eruda 在 bridge 之外则会覆盖 bridge → bridge 失效
const ERUDA_KEY = 'atr.devtools.eruda';
const CB_KEY = 'atr.devtools.consoleBridge';
const params = new URLSearchParams(location.search);
const erudaEnabled = params.get('eruda') === '1' || localStorage.getItem(ERUDA_KEY) === '1';
const cbEnabled = params.get('consolebridge') === '1' || localStorage.getItem(CB_KEY) === '1';

async function setupDevTools(): Promise<void> {
  if (erudaEnabled) {
    const { default: eruda } = await import('eruda');
    eruda.init();
  }
  if (cbEnabled) {
    const { installConsoleBridge } = await import('./utils/console-bridge.js');
    installConsoleBridge();
  }
}
void setupDevTools();

const container = document.getElementById('app');
if (!container) {
  throw new Error('找不到 #app 容器，index.html 是否正确加载？');
}

createRoot(container).render(
  <StrictMode>
    <I18nProvider>
      <ModalStackProvider>
        <ConfirmProvider>
          <App />
        </ConfirmProvider>
      </ModalStackProvider>
    </I18nProvider>
  </StrictMode>,
);
