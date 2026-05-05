# 架构总览

本文从开发者视角描述 open-claude-remote-clone 的模块组成、数据流、关键决策。
用户视角（怎么装、怎么跑）见根目录 [`README.md`](../README.md)。

## 包结构

monorepo 用 pnpm workspace，三个 package 共用 TS 严格模式：

```
.
├── shared/      @otr/shared    协议常量 / WS 消息 union / Error 体系
├── backend/     @otr/backend   Express + ws + node-pty + pino + web-push
└── frontend/    @otr/frontend  React 19 + Vite + xterm.js + Zustand
```

- shared 为 frontend 与 backend 唯一共用源。任何"协议"层面的东西
  （ServerMessage / ClientMessage union、ErrorCode、常量）都进 shared
- backend 启动时把 frontend dist 静态托管在 `/`（构建脚本 `copy-frontend-dist`
  把产物从 frontend/dist 拷到 backend/frontend-dist）
- 单元测试用 vitest 3，每个 package 自己跑

## 进程拓扑

```
   PC (运行 cli.js)                              手机 / 平板 webapp
  ┌──────────────────────────────────┐          ┌─────────────────┐
  │ Express 4 (HTTP + static)        │          │ React + xterm   │
  │ ws 8 (noServer，挂在同一 server) │  WS over │  ↕ ClientMsg    │
  │ ┌─────────────────────────────┐  │  HTTP    │     ServerMsg   │
  │ │ SessionController           │◀─┼──────────┤                 │
  │ │  ↕ WSClient (webapp/attach) │  │          │                 │
  │ │  ↕ PtyManager (node-pty)    │  │          └─────────────────┘
  │ │  ↕ HookReceiver (loopback)  │  │
  │ │  ↕ PushService (VAPID)      │  │
  │ │  ↕ OutputBuffer (重连回放)  │  │
  │ └─────────────────────────────┘  │
  │ AuthModule + RateLimiter         │
  │ InstanceRegistry (mkdir-lock)    │
  │ IpMonitor (30s 轮询)             │
  └──────────────────────────────────┘
            │ 同台机器多端口（多实例）
            ▼
   ┌─────────────────┐  ┌─────────────────┐
   │ Claude #1 :3000 │  │ Claude #2 :3001 │ ... 各自独立 PTY / 配置 / 订阅
   └─────────────────┘  └─────────────────┘
```

## 关键数据流

### 1. PTY → webapp（输出）

```
node-pty data event
  → PtyManager.onData
  → AnsiFilter（默认开启，丢弃 alt-screen 内输出）
  → SessionController.broadcastOutput
       ├── OutputBuffer.append（重连回放）
       └── 三阈值批合并（16ms / 32KB / 256KB）
            → webapp WSClient.sendBinaryFrame { type: terminal_output, data }
            → xterm.write
```

### 2. webapp → PTY（输入）

```
xterm onData → InputBar 或键盘
  → useWebSocket.send { type: user_input, data }
  → SessionController.dispatchInput
       └── PtyManager.write
```

### 3. 重连同步

```
新 WSClient 连入
  → SessionController.attach
       ├── 主从仲裁（webapp > attach > 仅 PC）
       └── WSClient.send { type: history_sync, data, cols, rows, status }
            （data 是 OutputBuffer.snapshot()，cols/rows 来自当前 PTY 尺寸）
```

### 4. Claude 审批 hook → 手机推送

```
Claude 进程子进程通过 ~/.claude/hooks 调 loopback POST /api/hook
  → HookReceiver.onNotification
  → SessionController 改 status=waiting_input + 广播 status_update
       └── PushService.notifyAll
            → Web Push Protocol
            → 手机 SW push event
            → showNotification（锁屏可达）
```

## 模块清单

### backend

| 模块 | 职责 |
|---|---|
| `cli.ts` / `index.ts` | 启动主入口，串起 14 步初始化 |
| `pty/pty-manager.ts` | node-pty wrapper：spawn / write / resize / data |
| `pty/output-buffer.ts` | 滚动 buffer，重连 history_sync 数据源 |
| `ws/ws-handler.ts` | WS upgrade + cookie 校验 + 客户端类型分流（webapp/attach）|
| `ws/output-batcher.ts` | 16ms/32KB/256KB 三阈值批合并 |
| `session/session-controller.ts` | PTY ↔ WS 中枢；主从仲裁；hook 接入 |
| `auth/auth-middleware.ts` | timingSafeEqual + Session Cookie（端口名后缀）|
| `auth/rate-limiter.ts` | 令牌桶 / 分钟限流 |
| `hooks/hook-receiver.ts` | 仅 loopback 的 /api/hook 路由 |
| `push/push-service.ts` | VAPID 三优先级 + 订阅持久化 + 410 自动 prune |
| `registry/instance-registry.ts` | 多实例注册表（mkdir-lock）|
| `registry/port-finder.ts` | 端口冲突自动递增 |
| `attach/attach-client.ts` | attach 子命令的 stdin/stdout 桥接核心 |
| `network/ip-monitor.ts` | 30s 轮询 LAN IP，含稳定阈值 |
| `utils/ansi-filter.ts` | 备用屏幕缓冲区（1049）状态机过滤 |
| `utils/qrcode-banner.ts` | 终端二维码渲染 |
| `config.ts` | 配置文件 read/write（atomic + 0o600） |
| `errors.ts` | AppError 子类树 |

### frontend

| 模块 | 职责 |
|---|---|
| `pages/ConsolePage.tsx` | 单页根，串 useTerminal + useWebSocket |
| `hooks/useTerminal.ts` | xterm 实例 + auto-follow + adaptToPtySize |
| `hooks/useWebSocket.ts` | WS reconnect + 消息分发 |
| `hooks/usePushNotification.ts` | Web Push 订阅生命周期 |
| `hooks/useLocalNotification.ts` | iOS < 16.4 fallback |
| `hooks/useUserConfig.ts` | /api/config 双向同步 |
| `hooks/useInstances.ts` | /api/instances 列表 + 创建 |
| `components/input/InputBar.tsx` | 输入框 + 快捷键条（dnd-kit）|
| `components/instances/InstanceTabs.tsx` | 多实例切换 |
| `components/common/PushToggle.tsx` | 推送订阅按钮 |
| `components/common/IpChangeToast.tsx` | IP 漂移底部 toast |
| `services/api-client.ts` | fetch 包装（统一 ErrorPayload）|

## 关键决策（ADR 索引）

每个 ADR 都按 5 段式：状态 / 背景 / 决策 / 理由 / 后果 / 备选方案。

| ADR | 标题 | 主要影响 |
|---|---|---|
| [001](./plans/open-claude-remote-clone/adrs/) | PTY + Hooks 审批方案 | （待写）|
| [002](./plans/open-claude-remote-clone/adrs/002-mkdir-as-lock.md) | mkdir-as-lock 文件锁选型 | InstanceRegistry / shared-token |
| [003](./plans/open-claude-remote-clone/adrs/003-cookie-name-port-binding.md) | Cookie 名后缀绑端口 | 多实例 cookie 隔离 |
| [004](./plans/open-claude-remote-clone/adrs/004-attach-master-slave.md) | webapp/attach 主从仲裁 | SessionController dispatch |
| 005 | WS 输出三阈值批合并 | （待写）|
| 006 | 单调 seq 仅作版本戳 | （待写）|
| [007](./plans/open-claude-remote-clone/adrs/007-alternate-screen-filter.md) | 启用 AlternateScreenFilter | 重连体验 / OutputBuffer 容量 |
| [008](./plans/open-claude-remote-clone/adrs/008-vapid-three-priority.md) | Web Push VAPID 三优先级 | PushService.init |
| [009](./plans/open-claude-remote-clone/adrs/009-error-handling.md) | 错误体系（AppError + ErrorCode）| 全后端错误响应 |
| [010](./plans/open-claude-remote-clone/adrs/010-feature-trim.md) | 裁剪 OnboardingGuide / 钉钉通知 | 与上游差异 |

## 启动顺序（backend index.ts）

```
1. parse CLI args + 读取/创建 config.json
2. 端口探测（port-finder）+ 申请端口锁
3. AuthModule + RateLimiter
4. PtyManager.spawn
5. OutputBuffer
6. SessionController（注入 PTY/Buffer）
7. ApprovalManager（HookReceiver 占位 server）
8. IP 探测 + qrcode-banner（除非 --no-terminal）
9. InstanceRegistry 注册自己
   1.8. IpMonitor 启动 + 注入到 SessionController（IP 漂移广播）
   1.9. PushService.init + setPushService 注入
10. Express server + ws upgrade 挂载
11. 优雅退出钩子（SIGTERM/SIGINT 都做完整清理）
```

## 测试矩阵

- 单元：vitest 3
  - shared 15 单测（协议字段不变性）
  - backend 284 单测（每模块）
  - frontend 主要测 hooks（仅 useUserConfig 接近端到端，余靠 build/typecheck）
- 集成：每阶段独立 smoke 脚本（`backend/scripts/smoke-stage*.mjs`）
  端到端起 backend 子进程 → 真 fetch / WS → 验证输出 → 全清理
- 跨阶段集成：`backend/scripts/smoke-cross.mjs`（阶段 10）

## 安全模型

- LAN-only：`server.listen(port, '0.0.0.0')`，但 token + cookie 双重门
  阻止外网；用户应该自己保证不暴露公网
- token 64-byte hex，timingSafeEqual 比较
- /api/hook 仅接受 loopback（127.0.0.1 / ::1 / ::ffff:127.0.0.1）
- 工作区白名单防穿越（path.relative + !startsWith('..')）
- 配置文件 0o600，配置目录 0o700
- WS upgrade 阶段同样走 cookie 校验
- 速率限制（默认 10 req/min/ip）防暴力枚举 token

## 已知边界

- iOS Safari < 16.4 不支持 Web Push，fallback 到 in-page Notification
- WSL 环境下 node-pty 的 native 编译需要 build-essential + python3
- 三阈值批合并的 256KB 是上限；超大单次输出（如 cat 大文件）
  会触发立即 flush
- AnsiFilter 当前只识别 1049（DECSET 的 alt-screen 现代变体），
  不识别 47 / 1047 / 1048 旧变体
