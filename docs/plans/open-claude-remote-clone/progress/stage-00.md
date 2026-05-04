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
- [ ] **0.3** backend 最小骨架：Express + /api/health + index 入口 + tsconfig
- [ ] **0.4** frontend 最小骨架：Vite + React + 空白页 + tsconfig
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

### 0.3 backend 最小骨架
（待开始）

### 0.4 frontend 最小骨架
（待开始）

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
