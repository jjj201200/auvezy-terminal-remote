/**
 * App 根组件
 *
 * 阶段 1：未认证、未多实例，直接挂 ConsolePage。
 * 阶段 2 加入 useAuth 后会按 token 是否有效在 AuthPage / ConsolePage 之间切换。
 */

import type { JSX } from 'react';
import { ConsolePage } from './pages/ConsolePage.js';

export function App(): JSX.Element {
  return <ConsolePage />;
}
