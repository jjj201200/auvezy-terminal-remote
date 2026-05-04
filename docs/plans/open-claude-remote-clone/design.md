# Open-Claude-Remote 复刻设计文档

> **状态**：设计稿 v1
> **日期**：2026-05-05
> **作者**：复刻者
> **路线**：clean-room 复刻（基于行为级规格分析，独立实现）

---

## 1. 项目目标

在局域网内通过手机或平板浏览器远程控制 PC 上运行的 Claude Code CLI。复刻范围参照上游 `open-claude-remote@0.1.1`，但裁剪 OnboardingGuide 与钉钉通知，其余功能完整实现。

### 1.1 不做什么（明确边界）

- **不做公网穿透**：仅绑定 LAN IP，不内置 frp / cloudflared / ngrok
- **不做多用户协作**：单用户 Token，多设备共享访问，不区分用户身份
- **不做 TLS / HTTPS**：MVP 阶段使用 HTTP，依赖局域网信任边界
- **不修改 Claude Code 本身**：仅通过 PTY + Hook 与之协作
- **不做账号系统**：Token + Session Cookie，无注册/找回/邮箱

### 1.2 做什么（功能清单）

✅ **保留的能力**
- 单实例代理（PTY 包装 Claude Code，PC 终端 + 浏览器双视图）
- 实时终端同步（xterm.js 渲染 ANSI，10K 行历史，重连恢复）
- Token 认证 + Session Cookie + 限流
- Notification Hook 审批通知（在 xterm 内交互，无专用弹窗）
- 多实例（不同项目并行）+ 共享 Token + 跨实例 Tab 切换
- Web 创建实例（带工作区白名单）
- attach 子命令（PC 端接管远程实例）+ 主从仲裁
- IP 漂移监控 + 自动通知前端
- 二维码扫码连接
- Web Push 推送通知（手机锁屏可达）
- 拖拽排序的设置页（快捷键 / 命令）
- 双 Ctrl+C 退代理
- ANSI alternate screen 过滤（**与上游不同：我们启用它**）

✂ **裁剪的能力**
- OnboardingGuide（首次使用引导）
- 钉钉通知（service + config + UI Tab 全部不实现）

### 1.3 不做的目标用户群

- **iOS Safari < 16.4 用户**：Web Push 不支持。可降级到前台 LocalNotification。
- **Windows 用户**：原版未明确测试，复刻同样不承诺 Windows 兼容。如需要再单独适配。

---

## 2. 法律与协议

- 上游仓库 LICENSE 文件 = MIT（Copyright 2024 Anthropic）
- 复刻产物**自定义 LICENSE**（建议 MIT）
- **不复制上游源码**——所有实现基于"行为级规格摘要"独立编写
- 上游未发布到 GitHub，npm 包是唯一公开分发形态

---

## 3. 技术栈选择

### 3.1 与上游一致（不变）

| 层 | 选择 | 理由 |
|---|---|---|
| 运行时 | Node.js ≥ 20 | 上游约束；ESM 一致性 |
| 包管理 | pnpm workspace | monorepo 统一构建 |
| 后端框架 | Express 4 + ws 8 | Express 路由生态 + ws 是最稳的 Node WS 实现 |
| PTY | node-pty 1.x | 唯一成熟跨平台选择 |
| 日志 | pino 9 | 结构化日志、性能好 |
| 前端框架 | React 19 | 上游约束；hooks 模型适合本场景 |
| 构建 | Vite 6 | 上游约束；启动快 |
| 终端渲染 | xterm.js 5 + fit/webgl/unicode11 addons | 业界标准 |
| 状态管理 | Zustand 5 | 比 Redux 轻、比 Context 强 |
| 测试 | vitest 3 + @testing-library/react | 上游约束；ESM 友好 |
| E2E | Playwright | 上游约束 |
| Web Push | web-push | VAPID/ECDH 自实现成本太高，必用现成库 |
| 二维码 | qrcode-terminal | 极轻量，stderr ASCII 绘制 |

### 3.2 与上游不同（自主决策）

| 项 | 选择 | 上游做法 | 我们的理由 |
|---|---|---|---|
| 拖拽排序 | `@dnd-kit/core` + `@dnd-kit/sortable`（保留） | 同 | — |
| 错误处理 | **统一 AppError 基类 + 错误码枚举** | 散落字符串错误 | 复刻要"清晰的控制逻辑"，错误必须类型化 |
| 注释规范 | **关键模块块级中文注释 + JSDoc 类型** | 中英混用 | 你的明确要求 |
| 配置常量 | **全部集中到 shared/src/constants.ts 或 backend/src/constants.ts** | 散落各文件 | 你的"常量管理"要求 |
| ANSI filter | **集成到主路径** | 仅定义未启用 | 既然实现就要用上 |

---

## 4. 仓库结构

```
open-claude-remote-clone/
├── shared/                          # 协议真相源（前后端共享）
│   ├── src/
│   │   ├── index.ts                 # 公共导出
│   │   ├── ws-protocol.ts           # WebSocket 消息类型
│   │   ├── constants.ts             # 默认值常量
│   │   ├── instance.ts              # 实例注册表类型
│   │   ├── defaults.ts              # 默认快捷键/命令
│   │   └── errors.ts                # 错误码枚举（新增）
│   ├── package.json
│   └── tsconfig.json
│
├── backend/                         # Node.js 服务端
│   ├── src/
│   │   ├── cli.ts                   # CLI 入口（全动态 import）
│   │   ├── cli-utils.ts             # 参数解析
│   │   ├── index.ts                 # startServer 启动序列
│   │   ├── attach.ts                # attach 子命令
│   │   ├── config.ts                # 配置加载与合并
│   │   ├── constants.ts             # backend 专用常量（批合并阈值等）
│   │   ├── errors.ts                # AppError 基类与所有错误子类
│   │   ├── api/                     # REST 路由
│   │   │   ├── router.ts
│   │   │   ├── auth-routes.ts
│   │   │   ├── config-routes.ts
│   │   │   ├── health-routes.ts
│   │   │   ├── hook-routes.ts
│   │   │   ├── instance-routes.ts
│   │   │   ├── push-routes.ts
│   │   │   └── status-routes.ts
│   │   ├── auth/                    # 认证模块
│   │   │   ├── auth-middleware.ts
│   │   │   ├── rate-limiter.ts
│   │   │   └── token-generator.ts
│   │   ├── hooks/                   # Claude Hook 接收
│   │   │   └── hook-receiver.ts
│   │   ├── logger/                  # pino 日志
│   │   │   └── logger.ts
│   │   ├── pty/                     # PTY 进程管理
│   │   │   ├── types.ts             # IPtyManager 接口
│   │   │   ├── pty-manager.ts       # 本地 PTY
│   │   │   ├── virtual-pty.ts       # 远程 PTY (attach)
│   │   │   └── output-buffer.ts     # 环形缓冲
│   │   ├── push/                    # Web Push
│   │   │   └── push-service.ts
│   │   ├── registry/                # 多实例注册表
│   │   │   ├── instance-registry.ts
│   │   │   ├── instance-spawner.ts
│   │   │   ├── port-finder.ts
│   │   │   ├── shared-token.ts
│   │   │   └── stop-instances.ts
│   │   ├── session/                 # 核心协调器
│   │   │   └── session-controller.ts
│   │   ├── terminal/                # PC 终端透传
│   │   │   └── terminal-relay.ts
│   │   ├── utils/                   # 工具函数
│   │   │   ├── ansi-filter.ts
│   │   │   ├── file-lock.ts
│   │   │   ├── ip-monitor.ts
│   │   │   ├── network.ts
│   │   │   └── qrcode-banner.ts
│   │   └── ws/                      # WebSocket
│   │       ├── ws-server.ts
│   │       └── ws-handler.ts
│   ├── tests/                       # vitest 单测
│   ├── package.json
│   └── tsconfig.json
│
├── frontend/                        # React + Vite
│   ├── public/
│   │   └── service-worker.js        # Web Push SW
│   ├── src/
│   │   ├── main.tsx
│   │   ├── App.tsx
│   │   ├── pages/
│   │   │   ├── AuthPage.tsx
│   │   │   └── ConsolePage.tsx
│   │   ├── components/
│   │   │   ├── common/              # ConnectionBanner / IpChangeToast / SafeArea / WorkspaceSelector
│   │   │   ├── input/               # InputBar / CommandPicker
│   │   │   ├── instances/           # InstanceTabs / CreateInstanceModal
│   │   │   ├── settings/            # SettingsModal / ShortcutSettings / CommandSettings / SortableItemShell
│   │   │   ├── status/              # StatusBar
│   │   │   └── terminal/            # TerminalView / ScrollToBottomButton
│   │   ├── config/
│   │   │   └── commands.ts          # 前端默认命令
│   │   ├── hooks/
│   │   │   ├── useAuth.ts
│   │   │   ├── useInstances.ts
│   │   │   ├── useLocalNotification.ts
│   │   │   ├── usePushNotification.ts
│   │   │   ├── useTerminal.ts
│   │   │   ├── useUserConfig.ts
│   │   │   ├── useViewport.ts
│   │   │   └── useWebSocket.ts
│   │   ├── services/
│   │   │   ├── api-client.ts
│   │   │   ├── instance-api.ts
│   │   │   ├── instance-create-api.ts
│   │   │   └── token-storage.ts
│   │   ├── stores/
│   │   │   ├── app-store.ts
│   │   │   └── instance-store.ts
│   │   ├── styles/
│   │   ├── types/
│   │   └── utils/
│   ├── tests/
│   ├── index.html
│   ├── package.json
│   └── tsconfig.json
│
├── e2e/                             # Playwright（独立包，不在 workspace 内）
│   ├── fixtures/
│   ├── helpers/
│   └── tests/
│
├── docs/
│   └── plans/
│       └── open-claude-remote-clone/
│           ├── design.md            # 本文档
│           ├── progress/
│           │   ├── overview.md
│           │   └── stage-NN.md
│           └── adrs/
│
├── scripts/
│   ├── copy-frontend-dist.js        # 把 frontend/dist 拷到 backend/frontend-dist
│   └── git-hooks/
│
├── install.sh
├── package.json                     # 根 package.json：dev/build/test/stop 脚本
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── .npmrc.example
├── config.example.json
├── README.md
├── ARCHITECTURE.md
└── LICENSE
```

**与上游差异**：
- `shared/src/errors.ts` 新增（错误码枚举）
- `backend/src/errors.ts` 新增（AppError 基类）
- `backend/src/constants.ts` 新增（批合并阈值等运行时常量统一收口）
- `notification/` 整个目录不存在（裁剪钉钉）
- `frontend/components/onboarding/` 不存在（裁剪 OnboardingGuide）

---

## 5. 核心架构

### 5.1 整体分层

```
┌─ Frontend (React SPA, served by Express) ────────────────────┐
│  Pages → Components → Hooks → Stores → Services (HTTP/WS)    │
└──────────────────────────────────────────────────────────────┘
                          ↕  HTTP / WebSocket
┌─ Backend (single Node.js process) ───────────────────────────┐
│                                                              │
│  Express App                                                 │
│  ├── /api/*              → API Router → AuthMiddleware → Handler │
│  ├── /ws (upgrade)       → WsServer (cookie 或 token 认证)   │
│  └── static frontend/    → frontend-dist + SPA fallback      │
│                                                              │
│  SessionController (核心协调器)                              │
│   ├── PtyManager (node-pty)  ← Claude Code CLI               │
│   ├── OutputBuffer (10K 行环形)                              │
│   ├── WsServer (broadcast / sendTo)                          │
│   ├── HookReceiver (Notification 事件)                       │
│   ├── TerminalRelay (PC stdin/stdout)                        │
│   └── PushService / AnsiFilter / IpMonitor (注入)            │
│                                                              │
│  Registry (多实例基础设施)                                   │
│   ├── ~/.claude-remote/config.json (token + 用户配置)        │
│   ├── ~/.claude-remote/instances.json (实例列表，文件锁)     │
│   ├── ~/.claude-remote/settings/<port>.json (Claude hook 配置) │
│   ├── ~/.claude-remote/vapid-keys.json (Web Push 密钥)       │
│   └── ~/.claude-remote/push-subscriptions.json (订阅列表)    │
└──────────────────────────────────────────────────────────────┘
```

### 5.2 数据流

#### 5.2.1 PTY 输出 → 三向分发
```
node-pty.onData(data)
  └─→ SessionController.onPtyData(data)
        ├─→ AnsiFilter.process(data)        // 可选：alt screen 过滤
        ├─→ process.stdout.write(filtered)  // PC 终端
        ├─→ OutputBuffer.append(filtered)   // 重连历史
        └─→ enqueueWsOutput(filtered)       // WS 批合并广播
              ├─ 16ms 时间窗
              ├─ 32KB 大小阈值
              └─ 256KB 高水位强 flush
```

#### 5.2.2 用户输入 → PTY（单一入口）
```
WS user_input  ╲
TerminalRelay stdin (raw mode)  → SessionController.onUserInput → ptyManager.write()
attach VirtualPtyManager  ╱
```

#### 5.2.3 审批通知扇出
```
Claude triggers Notification hook
  → POST /api/hook (仅 localhost)
    → HookReceiver.processHook(payload)
      → emit 'notification' (tool, message)
        └─→ SessionController.onHookNotification
              ├─ status = 'waiting_input'
              ├─ wsServer.broadcast(status_update)
              └─ pushService.notifyAll(...)
```

#### 5.2.4 客户端主从仲裁（resize 控制权）
```
状态机：
  无客户端          → PC 终端控制（TerminalRelay 监听 SIGWINCH）
  仅 webapp         → webapp 控制（PC resize 暂停）
  仅 attach         → attach 控制
  webapp + attach   → webapp 主控，attach 跟随
  
切换边界：
  webapp 连入        → pause TerminalRelay resize
  attach 连入        → pause TerminalRelay resize
  webapp 全断 attach 在 → 广播 terminal_resize 让 attach 重新自纠正
  全部断开           → resume TerminalRelay resize
```

### 5.3 控制流：启动序列（22 阶段）

参考上游 index.ts 的编号阶段，复刻保持同样的"启动单"思想，便于对照：

```
  1. loadConfig (CLI > config.json > defaults)
  2. ensureDefaultUserConfig (补 shortcuts/commands)
  3. shared token 获取或生成（withFileLock）
  4. instanceId = randomUUID()
  5. 创建 InstanceRegistryManager
  6. findAvailablePort（自动递增）
  7. 端口变化时刷新 sessionCookieName
  8. setInstanceContext (logger 注入 port)
  9. 创建 Express app + cors 白名单 + JSON parser
 10. 创建 HTTP server
 11. 创建 AuthModule
 12. 创建 HookReceiver
 13. 创建 PushService
 14. 创建 InstanceSpawner
 15. 挂 /api router
 16. 静态托管 frontend-dist + SPA fallback (跳过 /api 与 /ws)
 17. 创建 WsServer
 18. 创建 PtyManager
 19. 创建 TerminalRelay (条件：非 NO_TERMINAL 且 stdin.isTTY)
 20. 创建 SessionController + 注入 PushService / AnsiFilter
 21. 合并用户 settings + 写到 settings/<port>.json + spawn PTY
 22. 注册 instance + 清理死实例 settings + 启 IpMonitor
 + 挂 SIGINT/SIGTERM/stdin/EADDRINUSE/PTY exit
 + listen → 打印 banner + QR code
```

---

## 6. 协议规格（来自 shared/）

### 6.1 WebSocket 消息（11 种）

**Server → Client (8)**
- `terminal_output { data, seq }` — PTY 输出片段
- `status_update { status, detail? }` — idle / running / waiting_input
- `history_sync { data, seq, status, cols?, rows? }` — 重连全量回放
- `heartbeat { timestamp }`
- `error { code, message }`
- `session_ended { exitCode, reason }`
- `terminal_resize { cols, rows }` — 服务端通知尺寸变化
- `ip_changed { oldIp, newIp, newUrl }`

**Client → Server (3)**
- `user_input { data }`
- `resize { cols, rows }`
- `heartbeat { timestamp }`

### 6.2 状态机
```
SessionStatus = 'idle' | 'running' | 'waiting_input'

idle ──spawn──→ running ──hook──→ waiting_input ──user_input──→ running
running ──pty exit──→ idle
```

### 6.3 关键常量
```
DEFAULT_PORT              = 3000
DEFAULT_SESSION_TTL_MS    = 24h
DEFAULT_AUTH_RATE_LIMIT   = 20/分/IP
DEFAULT_MAX_BUFFER_LINES  = 10000
WS_HEARTBEAT_INTERVAL_MS  = 30s
WS_HEARTBEAT_TIMEOUT_MS   = 35s
TOKEN_BYTES               = 32  → 64 hex chars
SESSION_ID_BYTES          = 32
MAX_WS_MESSAGE_SIZE       = 1MB
WS_FLUSH_INTERVAL_MS      = 16ms（批合并时间窗）
WS_MAX_CHUNK_BYTES        = 32KB（批合并大小阈值）
WS_HIGH_WATERMARK_BYTES   = 256KB（背压水位）
```

---

## 7. 错误处理体系（新增设计）

### 7.1 错误码枚举（shared/src/errors.ts）

```typescript
export enum ErrorCode {
  // 认证类（1xxx）
  INVALID_TOKEN          = 'AUTH_INVALID_TOKEN',
  SESSION_EXPIRED        = 'AUTH_SESSION_EXPIRED',
  RATE_LIMITED           = 'AUTH_RATE_LIMITED',
  UNAUTHORIZED           = 'AUTH_UNAUTHORIZED',

  // PTY 类（2xxx）
  PTY_SPAWN_FAILED       = 'PTY_SPAWN_FAILED',
  PTY_NOT_RUNNING        = 'PTY_NOT_RUNNING',
  PTY_RESIZE_FAILED      = 'PTY_RESIZE_FAILED',

  // WS 类（3xxx）
  WS_INVALID_MESSAGE     = 'WS_INVALID_MESSAGE',
  WS_PAYLOAD_TOO_LARGE   = 'WS_PAYLOAD_TOO_LARGE',

  // 配置类（4xxx）
  CONFIG_PARSE_ERROR     = 'CONFIG_PARSE_ERROR',
  CONFIG_VALIDATION_FAIL = 'CONFIG_VALIDATION_FAIL',

  // 实例类（5xxx）
  INSTANCE_NOT_FOUND     = 'INSTANCE_NOT_FOUND',
  PORT_UNAVAILABLE       = 'PORT_UNAVAILABLE',
  WORKSPACE_FORBIDDEN    = 'WORKSPACE_FORBIDDEN',
  CWD_NOT_EXIST          = 'CWD_NOT_EXIST',

  // 文件锁类（6xxx）
  LOCK_TIMEOUT           = 'LOCK_TIMEOUT',

  // Push 类（7xxx）
  PUSH_VAPID_NOT_READY   = 'PUSH_VAPID_NOT_READY',
  PUSH_SUBSCRIPTION_INVALID = 'PUSH_SUBSCRIPTION_INVALID',

  // Hook 类（8xxx）
  HOOK_INVALID_PAYLOAD   = 'HOOK_INVALID_PAYLOAD',
  HOOK_NON_LOCALHOST     = 'HOOK_NON_LOCALHOST',

  // 内部类（9xxx）
  INTERNAL_ERROR         = 'INTERNAL_ERROR',
}
```

### 7.2 AppError 基类（backend/src/errors.ts）

```typescript
export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly httpStatus: number = 500,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

// 子类示例
export class AuthError extends AppError {
  constructor(code: ErrorCode, message: string, status = 401, cause?: unknown) {
    super(code, message, status, cause);
    this.name = 'AuthError';
  }
}

export class PtyError extends AppError { /* ... */ }
export class ConfigError extends AppError { /* ... */ }
export class InstanceError extends AppError { /* ... */ }
export class LockError extends AppError { /* ... */ }
export class HookError extends AppError { /* ... */ }
```

### 7.3 错误处理约定

- **业务模块抛 AppError 子类**，不抛 `Error` 或字符串
- **Express 路由层 catch**：根据 `httpStatus` 返回 JSON `{ error: { code, message } }`
- **异步 EventEmitter 错误**：emit `'error'` 事件，调用方负责 catch
- **WS 错误**：通过 `error` WS 消息广播，包含 code 与 message
- **第三方库错误**：catch 后包装为对应 `AppError` 子类，原错误放 `cause`

---

## 8. 常量管理

### 8.1 三层常量

| 层 | 文件 | 内容 |
|---|---|---|
| 协议常量 | `shared/src/constants.ts` | 端口、TTL、限流、buffer 上限、心跳、token 字节数、WS 上限 |
| 协议默认值 | `shared/src/defaults.ts` | 默认快捷键、默认命令 |
| 后端运行时 | `backend/src/constants.ts` | 批合并阈值、文件锁参数、IP 监控参数、重试策略 |
| 前端运行时 | `frontend/src/config/commands.ts` 等 | 重连退避序列、写队列阈值 |

### 8.2 严禁

- ❌ 在业务代码里硬编码 `30000`、`16`、`256 * 1024` 这种数字
- ❌ 在多个地方重复定义同一个常量
- ❌ 把可变默认值写进代码（应该通过 config.ts 经 ENV/CLI 覆盖）

---

## 9. 注释规范（中文）

### 9.1 三种注释级别

**A. 文件头块（必须）** — 每个 .ts 文件顶部
```typescript
/**
 * <模块名>
 *
 * <这个模块解决什么问题，为什么需要它>
 *
 * 主要职责：
 * - <职责 1>
 * - <职责 2>
 *
 * 不属于本模块的事：
 * - <边界划清>
 *
 * 关键设计：
 * - <非显然决策的解释>
 */
```

**B. 类/函数/接口（公共 API 必须）** — JSDoc 中文
```typescript
/**
 * <一句话功能描述>
 *
 * @param <参数> <参数含义与约束>
 * @returns <返回值含义>
 * @throws {AppError} <在什么情况下抛错>
 * @example
 * ```ts
 * <最小可运行示例>
 * ```
 */
```

**C. 行内注释（仅在 WHY 非显然时）**
```typescript
// 同尺寸跳过——避免 webapp→PTY→broadcast→client→webapp 无限回环
if (cols === this._cols && rows === this._rows) return;
```

### 9.2 严禁

- ❌ 写"这是一个变量"这种 WHAT 注释（变量名已说明）
- ❌ 写英文注释（除非是引用 RFC / spec 原文）
- ❌ 注释与代码不同步（注释比代码可信度低就有害无益）

---

## 10. 类型定义规范

- **接口优先于类型别名**（除非是 union / mapped type）
- **公共 API 类型 export，内部类型不 export**
- **避免 `any`**：用 `unknown` + 类型守卫；第三方库无类型时单独 `.d.ts`
- **配置类型双层**：`UserConfig`（all optional，文件层）+ `AppConfig`（all required，运行时）
- **协议类型 union by `type` 字段**：让 TypeScript 缩窄派生

---

## 11. 可扩展性设计点

### 11.1 已规划的扩展点

| 扩展场景 | 设计预留 |
|---|---|
| 新增通知渠道 | `SessionController.set<X>Service()` 模式，服务为可选注入；新增 X 只需实现接口 + index.ts 注入 |
| 新增 WS 消息类型 | `ws-protocol.ts` 加 union 成员；handler 加 case；前后端 build 后类型自动覆盖 |
| 新增 PTY 实现 | 实现 `IPtyManager` 接口（如 docker exec、ssh、wsl）；SessionController 不变 |
| 新增认证方式 | `AuthModule` 内部添加新的 verifier；ws-server upgrade 加新分支 |
| 新增配置项 | `UserConfig` 加可选字段 + `loadConfig` 加优先级链；frontend 设置页加 Tab |

### 11.2 不在 v1 但留口子

- **TLS 支持**：`createServer` 可换 `https.createServer`，`ws://` 升 `wss://`
- **远程 Registry**：`InstanceRegistryManager` 接口化后可换 Redis 实现
- **多用户**：`AuthModule` 加 `userId` 字段，session 带身份

### 11.3 强烈不应扩展的方向（YAGNI）

- ❌ 插件系统（不需要）
- ❌ 主题切换（GitHub Dark 一个就够）
- ❌ 国际化（**仅中文**，不做英文版本）
- ❌ 分布式锁服务（mkdir 锁对单机够用）
- ❌ 用户系统（单用户共享 Token 已够）
- ❌ 审计日志（pino app.log/error.log 已够）

---

## 12. 测试策略

### 12.1 测试金字塔

| 层 | 工具 | 覆盖目标 | 何时跑 |
|---|---|---|---|
| 单元测试 | vitest | 纯函数、状态机、协议解析、文件锁、限流 | 每步完成时 |
| 集成测试 | vitest + 真实 PTY/WS | SessionController 全链路、Auth 流程 | 阶段结束 |
| 手动 smoke | 手动 | 启动→连接→交互→断重连 | 阶段结束 |
| E2E | Playwright | 6 个核心场景回归 | 阶段 10 |

### 12.2 必须有单测的模块

- `shared/`：所有 union 类型守卫（如果有）
- `output-buffer.ts`：append/getFullContent/seq 单调
- `rate-limiter.ts`：窗口边界、并发计数
- `auth-middleware.ts`：timingSafeEqual、cookie parse、限流交互
- `file-lock.ts`：mkdir 原子、僵尸清理、并发竞争（启动 N 个进程同时取锁）
- `ansi-filter.ts`：跨 chunk 拼接、enter/exit 边界、嵌套
- `port-finder.ts`：递增、上限、TOCTOU 兜底
- `instance-registry.ts`：注册/注销、僵尸清理、并发写
- `network.ts`：isPrivateIp 三段范围
- `ip-monitor.ts`：稳定性阈值、抖动忽略

### 12.3 不写单测的部分

- Express 路由（用集成测代替）
- React 组件（用 e2e 代替；除非组件有复杂分支）
- pino 日志输出（信任库本身）

---

## 13. 安全清单（不可遗漏）

参考 ARCHITECTURE.md 第 7 节"Key Decisions"和原版安全设计：

- ✅ Token 用 `timingSafeEqual` 比较，长度先比
- ✅ 32 字节随机生成 → 64 hex 字符
- ✅ Session Cookie：HttpOnly + SameSite=Lax + secure 跟协议自适应
- ✅ Cookie 名后缀绑端口（多实例隔离）
- ✅ /api/hook 仅接收 loopback（127.0.0.1 / ::1 / ::ffff:127.0.0.1）
- ✅ Express CORS 白名单（同源 / displayIp / localhost / 127.0.0.1）
- ✅ 仅绑 LAN IP（自动检测 RFC1918；无则 fallback 127.0.0.1）
- ✅ 工作区白名单防穿越（path.relative + !startsWith('..'）)
- ✅ 限流 20/min/IP，认证成功后清零
- ✅ 配置目录 0o700、文件 0o600
- ✅ 注册表写入 tmp + rename 原子性
- ✅ JSON 解析失败备份原文件再用默认值覆盖
- ✅ 静态 SPA fallback 显式跳过 /api 和 /ws
- ✅ Push 订阅 410 Gone 自动清理过期
- ✅ Push p256dh 长度防御性校验

---

## 14. 阶段划分

| 阶段 | 主题 | 步骤数 | 关键交付 |
|---|---|---|---|
| **0** | 项目骨架与协议层 | 7 | monorepo 跑通；协议类型 + 错误码定义 |
| **1** | PTY ↔ WS ↔ xterm 闭环 | 12 | 浏览器看到 Claude 输出，能输入 |
| **2** | 认证与安全 | 11 | Token 认证、Session、限流、CORS |
| **3** | 审批通知 | 8 | Hook 接收，状态广播，xterm 内交互审批 |
| **4** | 配置体系 | 11 | CLI / config.json / 默认值三层；设置页 |
| **5** | 文件锁 + 共享 Token + 二维码 | 7 | 单实例完整，扫码连接 |
| **6a** | 多实例（后端） | 7 | Registry + port-finder + cookie 端口绑定 + spawn |
| **6b** | 多实例（前端 + Web 创建） | 6 | InstanceTabs + 跨实例切换 + WorkspaceSelector |
| **7** | attach 子命令 | 6 | VirtualPtyManager + 主从仲裁 |
| **8** | IP 漂移 + ANSI 过滤 | 7 | IpMonitor + AlternateScreenFilter |
| **9** | Web Push | 7 | VAPID + Service Worker + 订阅持久化 |
| **10** | 打磨与发布 | 7 | install.sh + README + ARCHITECTURE + E2E |
|  | **总计** | **96 步** | 约 15-20 工作日 |

每阶段：
1. **多个步骤**（颗粒度：一个 commit 一个步骤）
2. **每步完成 → 一个 commit + 同步进度文档** (`docs/plans/open-claude-remote-clone/progress/stage-NN.md`)
3. **阶段结束 → 手动 smoke test + 更新 overview.md**

具体步骤拆分见 `progress/stage-NN.md`。

---

## 15. 风险与缓解

| 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|
| node-pty 编译失败 | 中 | 阻塞 | install.sh 提示工具链；优先 pre-built binary |
| xterm.js 高频写入卡顿 | 低 | 严重 | 批合并 16ms/256KB（已纳入设计） |
| ESM 顶部 import 提升导致 logger 模式错位 | 高 | 中 | cli.ts 全动态 import（已纳入设计） |
| 多实例并发 token 生成不一致 | 中 | 严重 | mkdir 文件锁 + double-check（已纳入设计） |
| 重连风暴 | 中 | 中 | 退避 1/2/4/8/16/30s + connectionToken 防 race |
| Web Push 在 iOS Safari 不可用 | 高 | 低 | useLocalNotification 兜底（设计内） |
| 阶段间集成回归 | 中 | 中 | 每阶段手动 smoke + 阶段 10 自动化 e2e |
| 跨平台差异（macOS/Linux/Windows） | 高 | 中 | 仅承诺 macOS/Linux；Windows 单独验证 |

---

## 16. ADR 计划清单

预留 ADR 目录 `docs/plans/open-claude-remote-clone/adrs/`，与上游同样使用 5 段式格式（**状态 / 背景 / 决策 / 理由 / 后果**）。每条 ADR 在对应阶段开始前补写。

| 编号 | 标题 | 阶段 |
|---|---|---|
| 001 | PTY + Hooks 审批方案 | 0 |
| 002 | mkdir-as-lock 文件锁选型 | 5 |
| 003 | Cookie 名后缀绑端口（多实例 Cookie 隔离） | 6a |
| 004 | 客户端类型 webapp/attach 主从仲裁 | 7 |
| 005 | WS 输出三阈值批合并（16ms / 32KB / 256KB） | 1 |
| 006 | 单调 seq 仅作版本戳，不支持差量 | 1 |
| 007 | 启用 AlternateScreenFilter（与上游不同的决策） | 8 |
| 008 | Web Push VAPID 三优先级（env > file > generate） | 9 |
| 009 | 错误体系：AppError 基类 + ErrorCode 枚举（与上游不同的决策） | 0 |
| 010 | 裁剪 OnboardingGuide 与钉钉通知的取舍 | 0 |

---

## 17. 自检清单

设计文档完成自查：

- [x] 目标明确，边界清晰（"做"和"不做"都列了）
- [x] 法律协议清楚
- [x] 技术栈确定，与上游差异点列出
- [x] 仓库结构完整
- [x] 数据流图覆盖核心路径
- [x] 协议规格清楚（WS 消息、状态机、常量）
- [x] 错误处理体系设计完整（错误码枚举 + AppError 基类）
- [x] 常量管理三层划分明确
- [x] 中文注释规范有具体格式
- [x] 类型定义规范有具体规则
- [x] 可扩展点列出，YAGNI 也列出
- [x] 测试策略分层
- [x] 安全清单不遗漏
- [x] 阶段划分支持每步独立 commit
- [x] 风险与缓解列出
