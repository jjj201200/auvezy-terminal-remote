# 阶段 8 — API 归属重划分（broker / worker 重新分工）

## 触发

阶段 7 publish 后实测：broker-only 状态（没起任何 worker）下 webapp 完全不可用——
所有 `/api/*` 返回 404。原因：阶段 3 错把整个 router 留在 worker 端，broker 只做
反代 + 静态资源。这是架构层面归属错误，而非临时 bug。

设计文档：`design-v2-api-ownership.md`；架构决策：`adrs/011-api-ownership.md`。

## 目标

- broker 持有所有"系统级 / 全局" API（auth / config / instances / push / share /
  workdir-policy / SSE）
- worker 收窄到"实例级"（health / hook / WS）
- 前端 fetch 改绝对路径 `/api/*`，不再走 `/i/<id>/api/...`
- POST /api/instances 改异步 202 + SSE 推 ready
- broker 进程 daily-rotate log（保留 7 天）

## 子阶段执行情况

### Sub-stage A — 拆 createApiRouter（completed）

`backend/src/api/router.ts` 拆成两个工厂：

- `createBrokerApiRouter`：health + auth + config + instance + push + share +
  workdir-policy
- `createWorkerApiRouter`：health + hook（其余删除）

`backend/src/api/instance-routes.ts` 重写为 `createBrokerInstanceRoutes`：

- POST 改异步语义：立即返回 202 `{ instanceId, status: 'pending', instance: {...} }`
- broker 端预生成 `instanceId` 通过 `SpawnInstanceInput.instanceId` 传给 spawner，
  spawner 通过 env `ATR_INSTANCE_ID` 透传给 worker
- worker self-register 后 instances.json 出现该 id → file watcher 触发 SSE
- 30s ready 超时 broker 主动 SIGTERM 兜底
- DELETE 直接 `process.kill(pid, 'SIGTERM')`，不再走 HTTP self-shutdown 中转

### Sub-stage B — broker-server 注入完整依赖（completed）

`backend/src/broker/broker-server.ts`：

- 新增 `BrokerApiDeps` 注入接口
- 加 `express.json()` body parser + CORS（与 worker 同款 localHostnames 白名单）
- broker 自己的 `/api/health`（含 role/brokerVersion）保留在 broker-server 内联
  实现，broker `createBrokerApiRouter` 又会挂一个通用 `/api/health` —— Express
  路由顺序保证 broker 自己那个先匹配

`backend/src/broker/cli.ts` 的 `runBrokerStart` 装配：

- `acquireSharedToken` 从 `~/.atrrc` 拿共享 token
- `loadUserConfig` 读 config.json → ConfigStore
- `AuthModule` + `SessionsStore`（共享文件，跨进程会话）
- `PushService.init()`（VAPID + push-subscriptions.json）
- `startInstanceWatcher` for SSE
- `DefaultInstanceSpawner`（cliJsPath 解析到同包的 dist/cli.js）

### Sub-stage C — broker 复用 acquireSharedToken（completed）

合并到 Sub-stage B。broker 不接 CLI args，从 `defaultUserConfigPath()` 读。

### Sub-stage D — worker 收窄（completed）

`backend/src/index.ts`：

- 改用 `createWorkerApiRouter({ integrations })`（仅 health + hook）
- 删除 ConfigStore / DefaultInstanceSpawner / startInstanceWatcher / triggerShutdown
  闭包 / saveUserConfig 引用 / `UserConfig` import / static frontendDist 服务
- worker `instanceId` 现在优先读 `process.env.ATR_INSTANCE_ID`（broker spawn 注入），
  没有才本地 `randomUUID()`
- shutdown 流不再调 stopInstanceWatcher（broker 端持有 watcher）

`backend/src/push/push-service.ts`：

- 新增 `reloadSubscriptions()` 公开方法
- `notifyAll` 入口先 reload 一次订阅文件（解决 broker 写 / worker 读的 stale 问题）

### Sub-stage E — 前端改造（completed）

`frontend/src/services/api-client.ts`：

- `toRelative(path)` 改为"强制带前导斜杠"——所有 `/api/*` 命中 broker 根，不依赖
  base href

`frontend/src/services/push-api.ts`：直接 fetch 那条 path 也改绝对路径。

`frontend/src/hooks/useInstances.ts`：EventSource 改绝对路径
`/api/instances/stream`。

`frontend/src/services/instance-api.ts`：`CreateEnvelope` 类型加 `status?: 'pending'`
+ `instance.instanceId`，DELETE outcome 加 `'already-dead'` 状态。

useInstances 的 pending 命中机制不变——broker spawn 出来的子进程 pid = worker
self-register 时填的 `process.pid`（同一个进程），所以 expectedPid 命中规则继续
有效。

### Sub-stage F — 异步 spawn + log rotation（completed）

异步 spawn 已在 Sub-stage A 实现。

`backend/src/broker/broker-log-rotator.ts`（新）：

- 文件 `~/.auvezy/terminal-remote/broker-YYYY-MM-DD.log`
- 启动 + 每天 0 点扫一遍删除 mtime > 7 天的 broker-*.log
- write 接口包 appendFileSync（失败仅吞，不阻塞 broker）
- broker/cli.ts 在 runBrokerStart 顶部 install rotator + wrap `process.stderr.write`
  把 logger 的 stderr 输出镜像写文件

### Sub-stage G — 测试 + dev 文档（completed）

新 / 改测试：

- `src/api/instance-routes.test.ts`：完全重写（broker 友好版，6 测试）—— POST 202
  断言、isCurrent 永远 false、DELETE SIGTERM 通过 mock `process.kill` 验证
- `src/broker/broker-log-rotator.test.ts`（新，4 测试）：当天文件名格式、append 行为、
  7 天前清理（utimesSync 控制 mtime）、isBrokerLogFile 校验

`frontend/vite.config.ts` proxy 增加 `/i/`（实例特定 ws + api）反代到 :3000。

`CLAUDE.md` dev 重启流程更新——v2 起核心是 broker 进程，不是 worker；启动顺序
变成"先 broker → 再 vite"。

backend 测试：522 passed (46 files)；frontend typecheck：clean。

### Sub-stage H — ADR + progress（completed）

- `adrs/011-api-ownership.md`（新）
- `progress/08-阶段8-api-ownership.md`（本文件）

## 还没做

- ✅ smoke 脚本:`scripts/smoke-0.7-broker-only.sh` 已落档,跑 broker-only webapp
  完整链路(health / auth / manifest token 注入 / index.html token 注入 /
  POST instances 202 / worker /i/<id>/api/health 就绪)。无 PTY 依赖,可在 CI 跑
- 端到端:浏览器实测 v2 的 SSE pending 流(POST /api/instances → 202 →
  webapp 等 SSE → navigate)需要用户辅助
- ✅ bundle-backend.js:已验证 broker-log-rotator.ts 默认 ESM 树打包包入
  `backend/dist/cli.js`(0.7.6 实测含 `broker-YYYY-MM-DD` 字符串、`rotateBrokerLog`
  函数等);不需要额外配置

## 验收

- backend `pnpm test` → 522 passed
- backend `pnpm exec tsc --noEmit` → 0
- frontend `pnpm exec tsc --noEmit` → 0
- API 归属、SSE 异步、broker daily-rotate log、env-passthrough instanceId 全部就位
