# 阶段 2 — worker 改造

> 状态：进行中（开工：2026-05-09）
> Breaking：是。0.6.x 用户分享出去的 `http://lan-ip:port/?token=` URL 会失效。

## 目标

让 worker 从「LAN 直连入口」变成「broker 反代后端」：

1. worker 只听 `127.0.0.1`，不再向 LAN 暴露
2. AuthModule 改用共享 SessionsStore（cookie 名统一 `session_id`，不带 `_p<port>`）
3. worker 启动前 ensureBroker：检查 broker.json，没活着就 fork 一个
4. entry URL / push / share 都从 `X-ATR-Forwarded-*` 头反推（worker 自己不再知道外部 host）

## 切片策略

阶段 2 改动面广，按"加法 → 切换 → 删法"切成 4 个 sub-stage，每个都能独立 smoke test：

| Sub | 内容 | 风险 |
|---|---|---|
| 2A | 新增 `ensureBroker` + `getEntryUrl`（纯加法） | 低 |
| 2B | AuthModule 接入 SessionsStore，sync API → async；WS authenticate 也改 async | 中（API 签名 breaking） |
| 2C | worker `httpServer.listen('127.0.0.1')` + ensureBroker 接入 worker 启动流 | 中（LAN 直连断） |
| 2D | entry URL 全面切到 getEntryUrl；banner / IP monitor / share / push 改造 | 中 |
| 2E | 删 buildPublicUrl + detectDisplayIp 在 worker 路径的调用 + 删 LAN 二维码 | 低（只删死代码） |

> **2B 之后 LAN 直连不再可用，必须先有 broker（阶段 3 完成 proxy）才能访问 webapp**。
> 因此 2B 落地时可同步起一个最小 broker（仅 health endpoint），让 atr 启动后浏览器
> 至少能验证 broker.json + worker loopback 都活着；webapp 全功能要等阶段 3 反代接通。

## 任务清单

### 2A — 纯加法（不动旧路径）

- [x] `backend/src/broker/ensure-broker.ts` —— 检查 broker.json + fork detached + HTTP probe（commit 待补）
- [x] `backend/src/broker/forwarded-headers.ts` —— 常量 + getEntryUrl helper

### 2B — AuthModule 接入 SessionsStore（breaking：API 改 async）

- [x] `validateSession` / `createSession` 改 `Promise<...>`
- [x] cookie 名默认 `session_id`（同时兼容读取旧 `session_id_p<port>`，通过 `legacyCookieNames`）
- [x] `requireAuth` 中间件改 async；handleAuth 同步流程也改 async
- [x] WsServer.authenticate 签名改 `Promise<ClientType | null>`；upgrade handler 抽 `runUpgradeAuth`，
      reject 时统一转 401（避免 unhandled rejection）
- [x] sessions/test-helpers.ts：`createTmpSessionsStore` 工厂供测试 fixture 共用
- [x] AuthModule 测试新增 legacyCookieNames 兼容路径用例
- [x] 全量 451/451 全绿；build 零错

### 2C — 切换 worker 监听（breaking 起点）

- [x] cli-utils 加 `broker` 子命令（仅 `start` 动作，stop / status 留 6）
- [x] cli.ts 分发到 broker/cli.ts
- [x] broker/cli.ts: 启动 broker 进程（读 ATR_BROKER_PORT env），SIGINT/SIGTERM 优雅退出
- [x] index.ts：worker 启动前 `await ensureBroker(...)`；listen 强制 `127.0.0.1`；
      banner 顶行改为 broker 入口 URL
- [x] ensureBroker：锁目录父目录不存在自动 mkdir（首次启动 ~/.atr 不存在）
- [x] smoke：清干净 HOME → 启 worker → broker 自动 fork → broker.json 出现 +
      broker /api/health 200 + worker 监听 127.0.0.1:13800 + 无任何 LAN listener；
      `0.7.0 worker 强制只听 127.0.0.1` warn 日志按预期出现

### 2D — entry URL 切换

- [ ] SessionController.setPushService 接受 req-aware url 工厂（或在 push subscribe
      handler 里根据 req 算）
- [ ] api/share-routes.ts 用 getEntryUrl(req) 代替 buildPublicUrl(displayIp,...)
- [ ] api/push-routes.ts 同上
- [ ] IpMonitor：worker 不再需要监控 LAN IP（broker 那一层才需要）—— 移除 worker 启动时的 IpMonitor
- [ ] 单测覆盖 share / push 的 url 生成

### 2E — 清理

- [ ] 删 worker 路径中所有 `buildPublicUrl(displayIp, ...)` 调用
- [ ] 删 `detectDisplayIp` 在 worker 启动流的引用（network.ts 函数本身保留给 broker 阶段 3 用）
- [ ] 删 LAN 二维码 / Tailscale 二维码渲染逻辑（broker 才有展示场景）
- [ ] 删 buildPublicUrl 函数本体？—— 暂留，broker 还可能复用它的 token 拼接逻辑；阶段 3 决定

## 不做（推迟到后续阶段）

- ❌ broker http-proxy 反代 → 阶段 3
- ❌ broker `<base href>` 注入 → 阶段 4
- ❌ SPA 内部路由切实例 → 阶段 5
- ❌ `atr broker service install` CLI → 阶段 6
- ❌ broker 端 CLI 子命令（broker start / stop / status）→ 阶段 6 一并落

## 完成标准

- [ ] 所有单测全绿（428 + 阶段 2 新增）
- [ ] smoke：`atr claude` 后 `~/.atr/broker.json` 存在，broker /api/health 200，worker
      127.0.0.1:port/api/health 200
- [ ] 多 worker 共享 cookie：开两个实例分别 /api/auth，第二个的 cookie 在第一个 worker
      的 /api/config 上能直接通过校验（共享 SessionsStore 已生效）
- [ ] `pnpm build` 无错
- [ ] 0.7.0 主线代码不再含 `cookieName` 端口后缀拼接（grep `_p\${port}` 应空）

## 与 design.md 对应

- §3 决策 1（broker/worker 分离）→ 2B
- §3 决策 6（共享 sessions）→ 2A AuthModule
- §3 决策 8（X-ATR-Forwarded-*）→ 2A getEntryUrl
- §3 决策 9（worker loopback only）→ 2B
- §11 约束 1（broker ensure 走 withFileLock）→ 2A ensure-broker

## 进度日志

### 2026-05-09 — 写阶段 2 切片计划

把"worker 改造"切成 2A/2B/2C/2D，每个 sub-stage 独立 smoke。
准备从 2A 开始（纯加法，不破坏 0.6.x 现有路径）。

### 2026-05-09 — 2A 完成

ensureBroker + forwarded-headers 落地（21 个新单测）；commit `d4152fe`。

切片重组：原 2A 包含的 AuthModule 改造拆分到独立 2B（async API breaking
改动量大），原 2B/2C/2D 顺延为 2C/2D/2E。

### 2026-05-10 — 命名澄清

`getPublicUrl` → `getEntryUrl`（forwarded-headers + 测试 + 文档全套）。
"public" 容易被读成"公网"，但本 helper 仅返回**用户浏览器看到的入口
URL**，范围只在私网 / Tailnet / 反代域名 / loopback；0.7.0 不解决公网穿透。
ADR-008 上下文段加了术语澄清。

### 2026-05-09 — 2C 完成

- cli-utils + cli.ts 新增 `atr broker start`；broker/cli.ts 提供进程入口
  （读 ATR_BROKER_PORT env，SIGINT/SIGTERM 优雅 shutdown）
- index.ts worker 启动流：`ensureBroker` 前置；listen 强制 `127.0.0.1`，
  `cfg.host !== 127.0.0.1` 时 warn；banner 顶行改为 broker 入口 URL
- ensureBroker 修补：锁父目录不存在自动 mkdir（首启 ~/.atr 不存在场景）
- 新增 1 用例覆盖嵌套不存在父目录场景；全量 452/452 全绿
- smoke：HOME=/tmp/<x> 跑 worker → broker 自动 fork（unref detached）→
  broker.json 写出 → /api/health 200 → worker 仅 127.0.0.1 listen，无任何
  LAN listener；ADR-009 warn 日志出现

### 2026-05-09 — 2B 完成

- AuthModule 重写：构造时注入 SessionsStore；createSession / validateSession
  / requireAuth / handleAuth 全 async；cookie 名默认 `session_id` + 通过
  `legacyCookieNames` 兼容旧 `session_id_p<port>` 一段时间
- WsServer.authenticate 接受 sync / async 返回；新增 `runUpgradeAuth` 把
  rejection 安全转 401，避免 unhandled
- sessions/test-helpers.ts：`createTmpSessionsStore` 给测试 fixture 共享
- 4 个 api 路由测试 + auth-middleware 测试全部迁移；新增 2 个 legacy cookie
  兼容用例
- index.ts worker 启动流接入 sessionsStore（仍用 0.6.x 监听路径，2C 才切
  loopback）
- 全量 451/451 全绿（+2）；build 零错
