/**
 * Design System 展示页入口（独立于主 App）
 *
 * 访问：dev 模式下 http://localhost:5173/design.html
 * 用途：集中展示所有视觉 token、primitive 状态、组合 pattern、动效。
 *
 * 不进生产 bundle（vite multi-page 配置控制）。
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { DesignSystem } from './DesignSystem.js';
import '../styles/global.scss';

const container = document.getElementById('design-root');
if (!container) throw new Error('找不到 #design-root');

createRoot(container).render(
  <StrictMode>
    <DesignSystem />
  </StrictMode>,
);
