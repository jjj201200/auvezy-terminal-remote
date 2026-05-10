# 阶段 3 — broker HTTP / WS 反代

> 状态：✅ 已完成（2026-05-10）；未 commit，等用户确认
> 阶段 2 已落地：worker 只听 loopback、ensureBroker、SessionsStore 共享、push/cookie 切换。
> 阶段 3 目标：让浏览器访问 `http://<broker-host>:<port>/i/<id>/` 能真正命中到对应 worker。

## 目标

把 broker 从"骨架（仅 /api/health）"升级为"可用反代"：

1. broker 接受 `/i/<instanceId>/*` HTTP 请求 → 反代到 instances.json 中
   `instanceId` 对应的 worker `127.0.0.1:<port>`
2. broker 接受 `/i/<instanceId>/ws` WebSocket upgrade → 反代到 worker
3. broker 注入 `X-ATR-Forwarded-*` 头让 worker 端 `getEntryUrl(req)` 拿到正确入口
4. broker 提供根 `/` 静态资源（前端 dist），让用户首次访问看到 atr 主界面
5. SSE / 大 POST body / 长连接 等场景行为正常

## 切片策略

阶段 3 有 4 个 sub-stage，每个独立 smoke：

| Sub | 内容 | 风险 |
|---|---|---|
| 3A | 加 `http-proxy` 依赖 + `broker/proxy.ts` 极简封装（仅 createProxy） | 低（纯加） |
| 3B | broker-server 加 `/i/:id/*` HTTP + WS upgrade 反代；instances.json 解析；X-ATR-Forwarded-* 注入 | 中（核心闭环） |
| 3C | broker 静态前端 dist；根 `/` 返回 SPA 入口；阶段 4 才注入 base href，3C 只做静态服务 | 低 |
| 3D | smoke：跑 worker + broker，curl /i/&lt;id&gt;/api/health → 命中 worker；WS 连通 | 中 |

> **3B 之后**：浏览器访问 `http://<broker>:<port>/i/<id>/api/...` 已经能反代到对应 worker；
> 但前端 dist 加载的 `/assets/*` 还是会绕过 `/i/<id>/` 前缀（这是阶段 4 base href 才解决的）。
> 3D smoke 只验证 API / WS 链路，不验证完整 SPA 加载。

## 不做（推迟）

- ❌ HTML `<base href>` 注入 → 阶段 4
- ❌ vite `base: './'` + 前端相对路径切换 → 阶段 4
- ❌ SPA 内部路由切实例（history.pushState）→ 阶段 5
- ❌ broker 端 share endpoints（迁移自 worker）→ 留到阶段 4 / 5 顺手做
- ❌ `atr broker stop / status` CLI → 阶段 6

## 任务清单

### 3A — 加 http-proxy 依赖

- [x] `pnpm add http-proxy --filter auvezy-terminal-remote --ignore-scripts`
      （`--ignore-scripts` 跳过 backend postinstall——dev 环境 dist/postinstall.mjs
      要先 build 才有；postinstall 只在 npm 用户机器装 atr 时跑）
- [x] `pnpm add -D @types/http-proxy --filter auvezy-terminal-remote --ignore-scripts`
- [x] `backend/src/broker/proxy.ts`：`createProxyServer` + 头注入辅助 +
      `stripUnsafeForwardedHeaders`；统一 onError（HTTP 502 / WS destroy）
- [x] 6 个单测全绿

### 3B — broker 路由反代

- [x] `backend/src/broker/instance-router.ts`：
  - 解析 `/i/<id>/*` 前缀
  - `id` 不带尾斜杠 → 302 → `/i/<id>/`
  - 不存在 → 404 INSTANCE_NOT_FOUND
  - pid 死 → 502 BROKER_UPSTREAM_UNREACHABLE
  - 存在 → 注入 X-ATR-Forwarded-Instance/Host/Proto/Path + X-Forwarded-Host/Proto/For
  - 路径剥前缀（`/i/<id>/api/foo` → `/api/foo`）
- [x] `httpServer.on('upgrade')`：`/i/<id>/ws` → instance-router.handleUpgrade；
      其它 path → socket.destroy
- [x] `stripUnsafeForwardedHeaders`：先剥 client 自塞的 5 个 forwarded-* 头
- [x] `InstanceRegistryManager.readSync()`：广播给 hot path 的同步只读 API
- [x] `broker-server` 接受 `registry` 选项；只在提供时挂反代
- [x] `broker/cli.ts` 自动注入默认 InstanceRegistryManager
- [x] 9 个集成单测（真起假 worker + broker，covers 各种正负路径）全绿

### 3C — broker 静态资源

- [x] `BrokerAppOptions.frontendDist` 选项；存在则挂 `express.static` + SPA fallback
- [x] fallback 路径排除 `/api`、`/i/`、`/ws`
- [x] `.webmanifest` MIME 显式声明（PWA 安装预期）
- [x] `broker/cli.ts` 自动定位 `<backend>/frontend-dist/`
- [x] 2 个单测（带 + 不带 dist 路径）全绿

### 3D — smoke（已完成）

clean HOME → 启 worker（bash --port 13810）→ broker 自动 fork（13710）
- [x] broker /api/health → 200 ✓
- [x] worker /api/health 直连 → 200 ✓
- [x] 经 broker `/i/<id>/api/health` 反代 → 200，body 来自 worker ✓
- [x] 不存在 instance → 404 INSTANCE_NOT_FOUND ✓
- [x] `/i/<id>` 不带斜杠 → 302 ✓
- [x] 经 broker POST `/i/<id>/api/auth` → 200 + Set-Cookie（`session_id=...`）✓
- [x] 经 broker GET `/i/<id>/api/config` 携带 cookie → 200，鉴权通 ✓
- [x] 经 broker WS `/i/<id>/ws` upgrade → OPEN，收到 worker 的 history_sync ✓
- [x] 非 `/i/` 的 WS upgrade → broker destroy 不崩 ✓

**修复 1 个 bug**：`httpServer.on('upgrade')` 兜底 destroy 在 instance-router
改写 req.url 之后才执行，导致 `req.url = /ws` 不以 `/i/` 起头被错杀。改为
upgrade 入口先按原 url 判前缀。

## 完成标准

- [x] 全量单测全绿：473/473（+17：proxy 6 + instance-router 9 + broker-server static 2）
- [x] smoke 各项全过（详见 3D 列表）
- [x] `pnpm build` 无错
- [x] design.md §13 中"`atr claude` 后浏览器访问 broker URL 看到 atr 主界面"基本满足
      （静态资源已就绪，但完整 SPA 加载需要阶段 4 base href 注入；当前用户输入
      broker URL 能看到前端 index.html，但 SPA 自身 fetch 走的还是绝对路径会 404）

## 与 design.md 对应

- §3 决策 4（http-proxy）→ 3A
- §3 决策 8（X-ATR-Forwarded-*）→ 3B
- §7 broker 路由 → 3B/3C
- §7.2 SSE / WS 流式 → 3B（依赖 http-proxy 默认行为，加测试）

## 进度日志

### 2026-05-10 — 开工

写本文档；准备从 3A 加依赖开始。

### 2026-05-10 — 3A 完成

`http-proxy` + `@types/http-proxy` 装上（`--ignore-scripts` 跳过 backend
postinstall）。`broker/proxy.ts` 提供 `createProxyServer` + 头注入辅助 +
`stripUnsafeForwardedHeaders`；onError 统一 502 或 destroy。6 个单测。

### 2026-05-10 — 3B 完成

`broker/instance-router.ts` 落地：HTTP 路由 + WS upgrade 反代；instances.json
解析（新增 `InstanceRegistryManager.readSync()` 同步只读 API）；X-ATR-Forwarded-*
注入直接写到 req.headers（不走 proxyReq 全局监听，避免私有桥接头泄漏到
worker）；client 自塞 forwarded-* 头先剥后注。`broker-server` 接受可选
`registry`/`frontendDist`；`broker/cli.ts` 自动注入两者。9 个集成单测。

### 2026-05-10 — 3C 完成

broker 静态资源 + SPA fallback（`/api`、`/i/`、`/ws` 不走 fallback）。
broker/cli.ts 默认定位 `<backend>/frontend-dist/`。2 个单测。

### 2026-05-10 — 3D smoke 通

完整 worker + broker 链路：HTTP / POST 鉴权 / cookie 透传 / WS upgrade 全通。
修一个 bug：upgrade 兜底 destroy 在 req.url 改写后才执行，错杀正常 WS——
改为先判前缀再交给 instance-router。

全量 473/473 全绿；build 零错。阶段 3 整体完成（未 commit）。
