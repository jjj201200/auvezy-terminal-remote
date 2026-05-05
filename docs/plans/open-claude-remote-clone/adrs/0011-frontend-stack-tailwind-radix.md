# ADR-0011 · 前端样式栈选型：Tailwind v4 + Radix + vaul

## 状态

已采纳（2026-05-05）

## 背景

阶段 4–9 的 690 行手写 BEM `global.css` 已经覆盖了所有视觉细节，但：

- 字号 7 档无层级、移动端布局用 `100vh` 在地址栏 / 软键盘出现时溢出导致内容被挤出一屏；
- 设置面板与「创建新实例」用居中 modal，移动端体验差；
- 没有可访问性底座（焦点陷阱、`aria-*`、Esc 关闭）；
- 装饰大量依赖 emoji（🔔 ⚙ ⚠），与"极客 / 终端工具"调性不一致。

需要一次系统性升级。

## 决策

引入：

- **Tailwind CSS v4**（`@tailwindcss/vite`）：用 `@theme` 注入现有 CSS 变量为 token，组件层一律 utility，删除手写 BEM；
- **Radix UI primitives**（`react-dialog` / `react-tabs` / `react-switch` / `react-tooltip`）：a11y 底座；
- **vaul**：移动端底部 sheet 专用库（drag 手势、橡皮筋）；
- **lucide-react**：单色 stroke 图标，全面替换 emoji；
- **clsx**：条件 className 拼接。

新增 `frontend/src/components/ui/` 集中 primitives：`Sheet` / `IconButton` / `Pill` / `Toggle` / `TextField`。

## 理由

- Tailwind v4 零配置（无 `tailwind.config.js`、无 PostCSS），且 `@theme` 直接消费已有 CSS 变量，保留视觉资产；
- Radix 是行业事实标准的可访问性底座，体积友好（仅装用到的子包）；
- vaul 与 Radix Dialog 通过统一的 `open` / `onOpenChange` API 拼成 `Sheet` primitive，桌面 / 移动两形态零负担；
- lucide 图标继承 `currentColor` + 统一 `strokeWidth=1.5`，与 JetBrains Mono 字体的极客调性一致；
- 总打包增量约 28KB gzip（实测 build：JS 28KB / CSS 2.5KB），对项目轻量级前端可接受。

## 后果

正面：

- 全局移除 emoji，视觉一致性提升；
- 移动端布局改为 `100dvh` + `visualViewport` hook，键盘弹起时输入栏紧贴键盘上沿；
- SettingsModal / CreateInstanceModal 移动端走底部 sheet；
- 所有图标按钮触控目标 ≥40×40，符合移动端规范；
- 字号收紧为 6 档梯度，默认 13px；
- 新增 28 个 escape-codec 单测保护快捷键编辑层。

负面 / 待权衡：

- 引入 9 个新 npm 依赖，初期对维护人有一定学习成本；
- Tailwind v4 的 `@theme` 与 `bg-[var(--var)]` 任意值变体语法相对新，需要团队熟悉；
- vaul 在不支持 visualViewport 的极旧浏览器降级体验有限（不影响主流移动端）。

回退：每个 Stage 一次 commit；如果未来要回退，可逐 Stage `git revert` 到旧 BEM 实现。
