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
- [x] **0.5** ~~logger 基础（已并入 0.3）~~ 改为：vitest 测试基础设施 + shared/errors/logger 关键单测
- [x] **0.6** ~~errors 基础（已并入 0.3）~~ 改为：ADR-009 / ADR-010 落地 + ADR 通用模板
- [x] **0.7** 阶段 0 收尾：typecheck 全通 + overview 同步 + 端到端 smoke 复测

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
- workspace 包名前缀 `@otr/*`（避免与上游 `@claude-remote/*` 冲突，同时简短便于书写）
- `start` 脚本指向 `backend/dist/cli.js`（CLI 入口而非 index.js）——更符合 npm bin 调用习惯
- `noUncheckedIndexedAccess` 启用——契合"清晰控制逻辑"要求
- `onlyBuiltDependencies` 仅放 `esbuild` 和 `node-pty`——pnpm 9 安全模式

**未做的事**：
- 不写 `.npmrc`（让用户自己决定是否启用镜像）
- 不写 ESLint 配置（阶段 0.7 与其他工具一起加，避免一开始就引入太多依赖）

### 0.2 shared 包 · 完成 2026-05-05

**产出文件**：
- `shared/package.json`（@otr/shared，仅 typescript + vitest 两个 dev 依赖）
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
- `pnpm --filter @otr/shared build` 通过，dist/ 生成 12 个 .js + .d.ts 文件

### 0.3 backend 最小骨架 · 完成 2026-05-05

**产出文件**：
- `backend/package.json`（@otr/backend，bin: claude-remote → dist/cli.js）
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
- `pnpm --filter @otr/backend build` 通过
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
- `frontend/package.json`（@otr/frontend，含 React 19/Vite 6/xterm/Zustand/dnd-kit/testing-library）
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

### 0.5 vitest 基础设施 + 关键单测 · 完成 2026-05-05

**产出文件**：
- `shared/vitest.config.ts`（node 环境，仅 src/**/*.test.ts）
- `shared/src/ws-protocol.test.ts`（8 个测试覆盖 isServerMessage / isClientMessage）
- `backend/vitest.config.ts`（node 环境，src 与 tests 都收）
- `backend/src/errors.test.ts`（19 个测试覆盖 AppError 字段保留、cause 链、子类默认 httpStatus、toAppError 规范化）

**结果**：
- `pnpm --filter @otr/shared test` → 8/8 通过
- `pnpm --filter @otr/backend test` → 19/19 通过

**关键设计**：
- 类型守卫只校验 type 字段，不校验细节字段——契合"handler 二次校验"的分工
- AppError 测试覆盖 cause stack 拼接（非显然但易漏）
- toAppError 测试覆盖 4 种输入类型（AppError 直通 / Error 包装 / 字符串 / 其它对象）

**未做**：
- logger 模块单测——pino transport 异步初始化难以做单测，留到阶段 10 用 e2e 验证
- 各业务模块单测在对应阶段补

### 0.6 ADR 落地 · 完成 2026-05-05

**产出文件**：
- `docs/plans/open-claude-remote-clone/adrs/000-template.md`（5 段式模板：状态/背景/决策/理由/后果 + 可选备选方案段）
- `docs/plans/open-claude-remote-clone/adrs/009-error-handling.md`（AppError + ErrorCode 枚举 vs 裸 Error 字符串 code）
- `docs/plans/open-claude-remote-clone/adrs/010-feature-trim.md`（裁掉 OnboardingGuide + 钉钉通知）

**关键设计**：
- ADR 模板保持轻量（≈ 25 行），鼓励多写而不是写长
- 每条 ADR 都列出"备选方案"——记录"为什么不选某方案"对长期维护更有价值
- 阶段 0 仅落地阶段 0 自身触发的 ADR（009 / 010），其他阶段在对应阶段开头补

### 0.7 阶段 0 收尾 · 完成 2026-05-05

**修订**：
- `frontend/package.json` test 脚本加 `--passWithNoTests`（阶段 0 没前端测试，避免 vitest 退出码 1 卡住）

**typecheck 结果**：
- `pnpm typecheck` 静默通过（shared / backend / frontend 三包都过 strict + noUncheckedIndexedAccess）

**全测试结果**：
- shared：8/8 通过
- backend：19/19 通过
- frontend：passWithNoTests
- 总计 27/27 通过

**端到端 smoke（清理脚本一并验证）**：
- `pnpm build` 链路全过（shared → frontend → backend → copy-frontend-dist）
- `node backend/dist/cli.js` 启动 → `/api/health` 200 JSON、`/` 200 HTML（512B）
- `logs/app.log` 写入结构化日志含 instancePort 占位
- kill PID + 端口释放 + 临时文件 + logs 清理（CLAUDE.md 第 1 条规则到位）

## 验证结果

✅ pnpm install 通过（含 node-pty 编译）
✅ pnpm build 全链路通过
✅ pnpm typecheck 全通
✅ pnpm test 全通（27/27）
✅ 端到端 smoke 通过：/api/health → JSON、/ → SPA HTML、SPA fallback 正常、/api/* 不被劫持
✅ 测试结束所有进程与端口已释放

## 当前阻塞

无。

## 验证结果

（阶段完成后填写）
