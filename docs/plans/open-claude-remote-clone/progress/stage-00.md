# 阶段 0 进度：项目骨架与协议层

## 目标

搭起 monorepo 骨架，写出协议真相源（shared 包），整个仓库能 build 通过、能跑空 server。

## 验收标准

- `pnpm install` 通过
- `pnpm build` 全过（shared → frontend → backend）
- `pnpm dev` 能起空 Express 监听端口（无 PTY、无 WS）
- `npx tsc --noEmit` 在所有包内无错
- 阶段 0 ADR（009 错误体系、010 裁剪取舍）已写入

## 步骤清单

- [x] **0.1** 初始化 pnpm workspace + 根 package.json + tsconfig.base
- [x] **0.2** shared 包：constants / ws-protocol / instance / defaults / errors / index
- [x] **0.3** backend 最小骨架：Express + /api/health + index 入口 + tsconfig
- [x] **0.4** frontend 最小骨架：Vite + React + 空白页 + tsconfig
- [ ] **0.5** logger 基础（pino 配置 + 测试静默 + log 目录）
- [ ] **0.6** errors 基础：AppError 基类 + 子类（AuthError / PtyError / ConfigError / InstanceError / LockError / HookError）
- [ ] **0.7** ADR-009、ADR-010 文档落地 + 阶段 0 收尾（阶段进度同步 + overview 同步 + smoke test）

## 实施日志

### 0.1 初始化 pnpm workspace · 完成 2026-05-05

**产出文件**：
- `package.json`（根 workspace，scripts 链路：build → typecheck → dev → test → stop → clean）
- `pnpm-workspace.yaml`（三包：shared / backend / frontend）
- `tsconfig.base.json`（target ES2022 / module ESNext / strict + noUncheckedIndexedAccess）
- `.gitignore`（含 analysis/ 排除上游分析产物入仓）
- `.npmrc.example`（淘宝镜像 + strict-peer + isolated linker）
- `scripts/copy-frontend-dist.js`（前端 dist 拷贝到 backend/frontend-dist）

**关键决策**：
- workspace 包名前缀 `@ocr/*`（避免与上游 `@claude-remote/*` 冲突，同时简短便于书写）
- `start` 脚本指向 `backend/dist/cli.js`（CLI 入口而非 index.js）——更符合 npm bin 调用习惯
- `noUncheckedIndexedAccess` 启用——契合"清晰控制逻辑"要求
- `onlyBuiltDependencies` 仅放 `esbuild` 和 `node-pty`——pnpm 9 安全模式

**未做的事**：
- 不写 `.npmrc`（让用户自己决定是否启用镜像）
- 不写 ESLint 配置（阶段 0.7 与其他工具一起加，避免一开始就引入太多依赖）

### 0.2 shared 包 · 完成 2026-05-05

**产出文件**：
- `shared/package.json`（@ocr/shared，仅 typescript + vitest 两个 dev 依赖）
- `shared/tsconfig.json`（composite + outDir dist + 排除 *.test.ts）
- `shared/src/constants.ts`（协议常量：端口/TTL/限流/buffer/心跳/字节数/WS 上限/路径名）
- `shared/src/ws-protocol.ts`（11 种消息类型 + SessionStatus 枚举 + 两个类型守卫）
- `shared/src/errors.ts`（ErrorCode 枚举共 28 项，分 8 个分类 + ErrorPayload）
- `shared/src/instance.ts`（InstanceInfo / InstanceRegistry / InstanceListItem）
- `shared/src/defaults.ts`（8 个默认快捷键 + 5 个默认命令 + 两个配置类型）
- `shared/src/index.ts`（公共导出聚合）

**关键决策**：
- 协议字段名（如 `terminal_output`、`history_sync`）严格保持与上游一致——这是契约，名字一改 hooks 就断
- 协议常量与运行时常量分层：协议常量在 shared（前后端必须同步），运行时常量（如批合并阈值）放 backend
- 类型守卫 `isServerMessage / isClientMessage` 只校验 type 字段在已知集合内——细节字段由 handler 二次校验，避免重复
- ErrorCode 用 enum 而非字符串字面量 union——便于 `Object.values(ErrorCode)` 用于校验
- 默认命令裁剪：上游的 `/commit-commands:commit` `/feature-dev:feature-dev` 等是上游作者自定义 skill 的引用，复刻时只保留通用斜杠命令（5 个），用户可自己加

**验证**：
- `pnpm install`（76 包，47s）通过
- `pnpm --filter @ocr/shared build` 通过，dist/ 生成 12 个 .js + .d.ts 文件

### 0.3 backend 最小骨架 · 完成 2026-05-05

**产出文件**：
- `backend/package.json`（@ocr/backend，bin: claude-remote → dist/cli.js）
- `backend/tsconfig.json`（references shared，types: node）
- `backend/src/constants.ts`（运行时常量：批合并阈值/文件锁/IP 监控/PTY/关闭/端口/停止）
- `backend/src/errors.ts`（AppError 基类 + 8 个领域子类 + toAppError 规范化函数）
- `backend/src/logger/logger.ts`（pino 多目标：stderr/app.log/error.log + setInstanceContext mixin）
- `backend/src/api/health-routes.ts`（GET /api/health 公开端点）
- `backend/src/api/router.ts`（路由聚合工厂 + ApiRouterOptions 占位）
- `backend/src/cli.ts`（动态 import 模式入口，CLI_MODE 环境变量先于业务模块加载）
- `backend/src/index.ts`（startServer 骨架：Express + /api + EADDRINUSE 兜底 + SIGINT/SIGTERM）

**关键决策**：
- AppError 的 `cause` 字段需 `override` 修饰（Node 16+ Error 已有此字段，noImplicitOverride 强制声明）
- pino 多目标 transport 初始化是异步的（约 1s），smoke test 必须 sleep ≥ 5s
- cli.ts 顶部仅 `process.env.CLI_MODE = 'true'`，其余全部动态 import——契合 ESM 顶部提升的复刻要求
- logger 初始化在测试环境（NODE_ENV=test 或 VITEST）静默
- Express 的 EADDRINUSE 错误处理保留——TOCTOU race 在阶段 6a 起会真正用到

**验证**：
- `pnpm install` 通过（含 node-pty 编译）
- `pnpm --filter @ocr/backend build` 通过
- `node backend/dist/cli.js` 启动后：
  - 端口 3000 正常监听
  - `curl http://127.0.0.1:3000/api/health` 返回 `{"ok":true,"timestamp":"...","uptime":N}`
  - stderr 打印就绪横幅
  - `logs/app.log` 写入结构化日志
  - SIGINT 触发优雅关闭

**踩坑记录**：
- WSL 上首次 `pnpm install` 失败：node-pty 需要 build-essential（make/gcc/g++），sudo apt-get install 解决
- curl 默认走 http_proxy 代理（`192.168.1.4:10808`），smoke test 必须 `--noproxy "*"`

### 0.4 frontend 最小骨架 · 完成 2026-05-05

**产出文件**：
- `frontend/package.json`（@ocr/frontend，含 React 19/Vite 6/xterm/Zustand/dnd-kit/testing-library）
- `frontend/tsconfig.json`（references shared，jsx: react-jsx，types: vite/client）
- `frontend/vite.config.ts`（dev: 5173 + proxy /api /ws → 3000；build: dist/）
- `frontend/index.html`（中文 lang，viewport-fit=cover，theme-color GitHub Dark）
- `frontend/src/main.tsx`（StrictMode + createRoot + 容器存在性校验）
- `frontend/src/App.tsx`（fetch /api/health 显示状态 + DEFAULT_PORT 显示验证 shared 导入）
- `frontend/src/styles/global.css`（CSS 变量：GitHub Dark 配色 + safe-area-inset 占位 + 等宽字体链）
- `backend/src/index.ts`（增量：静态文件挂载 + SPA fallback，跳过 /api 与 /ws）

**关键决策**：
- React 19 中 `JSX.Element` 已移到 `import { JSX } from 'react'`（不再是全局命名空间）
- Vite proxy `/ws` 必须显式 `ws: true`，否则 WebSocket 升级握手会被普通 HTTP 代理破坏
- 根 `package.json` 加 `type: module` 消除 scripts/copy-frontend-dist.js 的 ESM 解析告警
- 静态文件路径用 `dirname(fileURLToPath(import.meta.url))` 解算到 `backend/frontend-dist/`，与 cwd 无关
- SPA fallback 用 `app.get('*', ...)` + 显式 `req.path.startsWith('/api')` 跳过——避免劫持后端路由

**验证**（端口 3000 监听后）：
- ✓ `/api/health` 返回 `{"ok":true,...}`
- ✓ `/` 返回 200 含 `#app` 容器（512B HTML）
- ✓ `/assets/index-*.js` 加载 197KB
- ✓ `/some/spa/route` SPA fallback 200 → index.html
- ✓ `/api/nonexistent` 404（不被 SPA 劫持）
- ✓ 测试结束 PID kill + 端口释放 + 临时文件清理（CLAUDE.md 第一条规则）

### 0.5 logger 基础
（待开始）

### 0.6 errors 基础
（待开始）

### 0.7 阶段 0 收尾
（待开始）

## 当前阻塞

无。

## 验证结果

（阶段完成后填写）
