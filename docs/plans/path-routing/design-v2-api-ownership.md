# 设计 v2：API 归属重划分（broker / worker）

> 关联：design.md §11 share endpoints TODO；阶段 3 补强
> 触发：实测发现 broker 单独跑（无任何 worker）时 webapp 完全不可用——所有
> `/api/*` 返回 404，因为 0.7.0 阶段 3 把"`/api/*` 都属于某个 worker"作为隐含
> 假设。这是架构层面的归属划分错误，应彻底修复而非打补丁。

## 1. 当前问题

阶段 3 设计 `instance-router` 时，规则是：
- `/i/<id>/api/*` → 反代到对应 worker
- `/api/*` → broker 静态服务的 SPA fallback（命中 index.html，**不是** API 实现）

结果：

| 场景 | 当前行为 | 期望行为 |
|---|---|---|
| 用户开机后没起任何 worker，远程访问 broker | 看到 webapp 主界面 → AuthPage 调 `/api/auth` → 404 → 卡住 | 能登录、能创建实例、能查看实例列表 |
| 已有一个 worker，webapp 调 `/api/instances` 列实例 | 经 `/i/<id>/api/instances` 反代到那个 worker；worker 自己读 instances.json 列出**所有**实例 | 应该能在没 worker 时也列实例（哪怕空） |
| 创建第二个实例 | 经 `/i/<idA>/api/instances` POST → instance-A worker spawn 子进程 → 新 worker 跟 instance-A 父进程绑定 | broker 应该是真正的 spawn parent，worker 死后子实例不连带 |
| Push 订阅 | 经 `/i/<id>/api/push/subscriptions` → worker 写到共享 push-subscriptions.json | broker 直接管 push 订阅（VAPID + 订阅列表全局共享，与具体 worker 无关） |

## 2. 错误的根本原因

design.md ADR-001 说 broker 与 worker 严格分离，但**没明确划分谁负责哪类 API**。
0.6.x 时单进程兼任两者，所有 API 都在一个 router 里；阶段 3 我把整个 router
原样保留在 worker 端，broker 只做反代——这就是错误。

正确的划分原则：

> **broker 管"系统级 / 跨实例 / 全局"**：登录、用户配置、实例列表与生命周期、
> push 订阅、share endpoints、health
>
> **worker 只管"自己这个 PTY 实例"**：终端 IO、状态机、hook 接收、PTY 子进程
> 控制（resize / write / kill）

按这个划分，零 worker 状态下 broker 仍能完整服务 webapp；webapp 选中某个实例
后才需要跟该 worker 通信（WS + 实例特定 API）。

## 3. 重新归属表

### broker 端 API（新增）

| 路径 | 方法 | 鉴权 | 实现来源 |
|---|---|---|---|
| `/api/health` | GET | 无 | 已有 |
| `/api/auth` | POST | 限流 | 从 worker 迁移：AuthModule.handleAuth |
| `/api/config` | GET / PUT | session | 从 worker 迁移；config 文件全局共享 |
| `/api/instances` | GET | session | 从 worker 迁移：直读 InstanceRegistryManager |
| `/api/instances` | POST | session | **重大**：broker 成为 InstanceSpawner 的真正持有者 |
| `/api/instances/:id` | DELETE | session | 从 worker 迁移；按 instanceId 查 pid → SIGTERM |
| `/api/instances/stream` | GET (SSE) | session | 从 worker 迁移：监听 instances.json file watcher |
| `/api/share/endpoints` | GET | session | broker 才知道自己监听 host 集合，迁过来天然合理 |
| `/api/push/vapid` | GET | 无 | 从 worker 迁移；VAPID 全局共享 |
| `/api/push/subscriptions` | POST / DELETE | session | 同上 |
| `/api/workdir-policy` | GET | session | 从 worker 迁移；workdir 策略全局 |

### worker 端 API（保留 / 收窄）

| 路径 | 方法 | 鉴权 | 备注 |
|---|---|---|---|
| `/api/health` | GET | 无 | 保留作 broker 反代时的 worker 探活；与 broker 自身 health 不冲突（broker 反代 `/i/<id>/api/health` → worker） |
| `/api/hook` | POST | loopback only | claude hook 仅 worker 进程可达；不该到 broker |
| `/api/instances/self/shutdown` | POST | session | worker 自己关自己的优雅 endpoint，保留（broker 收到 `/i/<id>/api/instances/self/shutdown` 反代过去） |
| **WebSocket `/ws`** | upgrade | session | 实例 PTY IO；**这是 worker 唯一对外暴露的核心** |

### worker 端**删除**的 API（这些功能搬走）

- `/api/auth` —— broker 端实现，cookie 落到 broker origin（与 worker 用同 SessionsStore，反代时 cookie 自然透传）
- `/api/config` GET/PUT
- `/api/instances` GET / POST / DELETE / stream
- `/api/share/endpoints`
- `/api/push/*`
- `/api/workdir-policy`

worker 不再需要 InstanceRegistryManager / InstanceSpawner / PushService /
ConfigStore / WorkdirPolicy 这些注入——它现在的职责是「一个 PTY 进程的终端
IO」，纯粹得多。

## 4. 新增组件 / 重构

### 4.1 抽出"无 PTY API server"

把当前的 `createApiRouter` 拆成两组：

- `createBrokerApiRouter(...)`：broker 端 API（auth / config / instances / push / share / workdir）
- `createWorkerApiRouter(...)`：worker 端 API（hook / self-shutdown / health-via-broker）

router.ts 不再存在；改为两个独立函数。

### 4.2 broker 启动多了一批依赖注入

broker 进程现在要持有：

```
- AuthModule（cookie + token + SessionsStore）
- InstanceRegistryManager（broker 已有，进程内单例）
- InstanceSpawner（用于 POST /api/instances）
- PushService（VAPID + 订阅）
- ConfigStore（用户 config.json 读写）
- WorkdirPolicy snapshot 函数（CLI flag / env / 文件三段优先级）
```

这意味着 broker 不再是"无状态反代"——它有持久状态了。但所有状态都是「文件落盘
+ 进程内缓存 / watcher」，**没有"独占资源"**：broker 重启后从文件恢复。这与
ADR-002（broker 永驻 + 重启不留 grace period）一致。

### 4.3 broker 启动时如何拿 token？

worker 当前从 `cfg.token`（CLI / env / config.json shared-token）拿。broker 进程
不接 CLI 参数（`atr broker start` 简单），但需要 token。

**方案**：broker 启动时复用 `acquireSharedToken({ path: ~/.atrrc })` —— 与 worker
共用同一份 token 来源。第一个跑的进程（worker 或 broker）生成；后跑的复用。

这不破坏现有共享 token 语义。

### 4.4 broker 持有 InstanceSpawner 后，spawn 路径变化

0.6.x：webapp POST `/api/instances` → 当前 worker 进程 spawn 新 worker（新 worker
父进程是当前 worker）。

0.7.0 现状（待修）：webapp POST `/i/<idA>/api/instances` → instance-A worker
spawn → 新 worker 父进程是 instance-A。

新设计：webapp POST `/api/instances`（broker 根路径）→ broker spawn → 新 worker
父进程是 broker。这更对：
- 关 instance-A 时不会连带杀 instance-B（虽然 detached + unref 已经避免了，但
  broker 当父更语义清晰）
- broker 永驻 + 子进程 detached → 实例进程独立生命周期

但 0.7.0 worker 在 ensureBroker 时 fork broker 形成"鸡生蛋"循环——这条不变，
ensureBroker 不需要 broker 端的 InstanceSpawner，只需要 broker.json + listen。

### 4.5 worker 如何注册到 instances.json？

当前：worker 启动 → `registry.register({ instanceId, host, port, pid, ... })`
写自己的信息到 instances.json。broker 反代时 `readSync` 拿 worker 端口。

新设计**保持不变**：worker 仍自注册——它最清楚自己 listen 在哪个 port。broker
spawn 时知道 instanceId（生成 UUID 传给 worker 通过 env），其他字段由 worker
listen 成功后自填。broker 通过 file watcher 等到 worker 注册完成才通知 webapp
"实例已就绪"。

### 4.6 worker 不再需要 frontendDist

worker 不再服务 SPA / 静态资源——所有静态资源都由 broker 提供。worker 只对
broker 反代来的 `/api/health` / `/api/hook` / `/api/instances/self/shutdown` /
`/ws` 响应。

这让 worker package 体积更小（不打 frontend-dist），bundle-backend.js 不变（仍
由 broker 在同一个 backend npm 包内提供）。

### 4.7 push subscription entryUrl 计算变化

现状：push subscribe handler 在 worker 端，从 X-ATR-Forwarded-Host 反推 entryUrl。

新设计：push subscribe handler 在 broker 端（`/api/push/subscriptions` 不带
`/i/<id>/`）—— broker 直接看 `req.headers.host`，不需要反推。entryUrl 形如
`http://<host>/`（broker 根入口；webapp 单 PWA 模型下打开 broker 根 → 自己
内部路由切实例）。

push 通知点击跳到 broker 根 URL 即可，webapp mount 时如果用户希望直接进某个
实例可以在 push 数据里塞 `instanceId` 让 webapp pushState 切过去。

## 5. 兼容性 / 迁移路径

旧客户端 webapp（0.7.0 已发部分用户）会调 `/i/<id>/api/auth`。新设计 worker 不
再有 `/api/auth`。两条路径：

- **A. 完全切换**（推荐）：worker 删 auth / config / instances / push / share /
  workdir 路由；旧 webapp 缓存的 SW 在第一次调到 worker 端 404 时会 SW update
  → 重新加载新 webapp（指向 broker 根）。
- **B. 临时兼容**：worker 保留 stub，`/i/<id>/api/auth` 返回 302 重定向到
  `/api/auth`（broker 根）让浏览器自动重试。增加复杂度但只对早期 alpha 用户
  有意义。

我倾向 A——0.7.0 还没正式 publish 到 npm，没有真实用户压力。

## 6. 测试范围

新增 / 大改的测试：

- `broker-api-router.test.ts`：8 个 broker API endpoint 完整覆盖（包含无 worker
  状态）
- `worker-api-router.test.ts`：精简版，只剩 health / hook / self-shutdown
- `instance-router.test.ts`：补充零 worker 时根 `/api/auth` 不被反代的用例
- 集成测试：broker only（无 worker）→ webapp 登录 → POST /api/instances
  spawn → 等到 instances.json 出现该 id → done

## 7. 实施切片

| Sub | 内容 | 行数估计 |
|---|---|---|
| A | 拆 createApiRouter → createBrokerApiRouter / createWorkerApiRouter | -200 / +250 |
| B | broker-server.ts 接受 broker API router；broker/cli.ts 注入 AuthModule / SessionsStore / InstanceSpawner / PushService / ConfigStore | +150 |
| C | broker 启动复用 acquireSharedToken | +20 |
| D | worker index.ts 拆掉相应 router 注册；删 PushService（移交 broker，worker 只通过 ws 推 status） | -100 |
| E | 前端无变化（fetch 路径已经是相对：`api/auth` → 在 `/i/<id>/` 下解析为 `/i/<id>/api/auth`，**但 0.7.0 我们要让它直接命中 broker 根**——这里需要前端从 base href scope 跳出来，待论证） | TBD |
| F | 测试 + smoke | +200 |

**E 是最棘手的**——见下节。

## 8. 棘手问题：前端 fetch 路径如何到 broker 根？

阶段 4 我们让前端用相对 URL（`fetch('api/auth')`），配合服务端注入的
`<base href="/i/<id>/">` → 实际请求是 `/i/<id>/api/auth`。

但新设计要求 `/api/auth` 命中 broker 根，**不**走 instance-router 反代。两个选择：

### 选择 1：前端 fetch 用绝对路径 `/api/auth`

恢复 0.6.x 形态。但：
- 单 PWA 多实例切换时所有 API 调用永远命中 broker → 跨实例切换更"轻"
- WebSocket 还是要按 instance 走 `/i/<id>/ws`（这条 base href 不能 cover，
  buildWsUrl 里仍要带 instanceId）

实施代价：阶段 4C 改的所有 fetch 路径全部还原带 `/`；与 base href 失配——但
绝对路径不靠 base href，所以这正确。

### 选择 2：保留相对 fetch，让 broker 反代 `/i/<id>/api/auth` → broker 自身处理

instance-router 增加例外：`/i/<id>/api/auth`、`/i/<id>/api/config`、
`/i/<id>/api/instances/...` 等"全局" API 不反代到 worker，由 broker 自身路由处理
（忽略 instanceId）。

实施代价：instance-router 多一组路径白名单；用户感觉是"任何 instanceId 下都能
登录"，符合 SPA 单 PWA 行为。

**我倾向选择 1**：语义最清晰。"broker 根 API" 就是 `/api/*`，"实例特定" 就是
`/i/<id>/ws`。fetch 用绝对路径不依赖 base href（SW / PWA 持久化 URL 时也对）。

## 9. WS 形态确认

WebSocket 永远是 `ws://host/i/<id>/ws`（实例特定）。broker 自己**不**有
`/ws`——它没什么可以推送的（没 PTY IO）。这条不变。

但 broker 的 SSE `/api/instances/stream`（实例列表实时变化）值得保留：webapp
零实例时也要订阅"哪天有实例创建了刷一下列表"。

## 10. v2 复审：盲点 / 待确认

回头审视 §1-9，找出几处不够严谨或我之前没充分想清楚的：

### 10.1 worker 的 `/api/health` 与 broker 的 `/api/health` 路径冲突

§3 表格里写"worker 保留 `/api/health`"——但 broker 也有 `/api/health`。当客户端
访问 `http://broker/api/health` 命中 broker；访问 `http://broker/i/<id>/api/health`
命中**通过 broker 反代到 worker** 的那个。**没有冲突**——instance-router 的反代
规则按前缀剥 `/i/<id>` 后转发到 worker，worker 端 `/api/health` 自洽。这条 OK。

### 10.2 `/api/instances/self/shutdown` 的归属

worker 自关 endpoint：`/i/<id>/api/instances/self/shutdown`。语义"我（这个
worker）请求 broker 关掉我自己"。但既然 broker 有 `DELETE /api/instances/:id`，
**这个 self-shutdown 还有必要保留吗**？

- worker self-shutdown 的真实使用场景是 webapp 顶栏 "断开 + 关闭" 按钮，0.6.x
  形态下 webapp 调当前 instance 的 self/shutdown，让 worker 自己优雅退出
- 0.7.0 形态下 webapp 完全可以走 `DELETE /api/instances/:id`（broker 端处理
  → 给目标 worker pid 发 SIGTERM）
- self-shutdown 唯一保留理由：**worker 想"自杀"时不想绕过 broker**（比如内部
  错误检测到无法继续）。但 worker 完全可以直接 `process.exit(...)` 或抛错——
  "self-shutdown HTTP endpoint" 给自己调没意义

**结论**：删掉 worker 端 `/api/instances/self/shutdown`。webapp 关闭实例统一走
broker 的 DELETE。

### 10.3 worker 端鉴权依赖

worker 现存 API（`/api/hook`、`/ws`）的鉴权来源：

- `/api/hook`：仅 loopback IP 能访问（不需要 session）
- `/ws`：用 session cookie 验

但 cookie 形态——`session_id=<uid>` 是 broker 写的。worker 验证 session 需要
SessionsStore（共享文件，没问题）+ AuthModule（cookie 名 / 时序安全 token 比
较）。worker 仍需要 AuthModule 实例**用于 WS 鉴权**。

**结论**：worker 仍保留 AuthModule + SessionsStore；只是不挂 `/api/auth`
endpoint。worker 端不发新 cookie，只**验证**已有 cookie。这一点我之前没写清楚，
"worker 不需要 AuthModule" 的说法是错的。

### 10.4 token 的写入端

§4.3 我说"broker 复用 acquireSharedToken"。但 worker 也仍调 acquireSharedToken
（用于 WS verifyToken 的 `?token=` 路径，attach 客户端用）。两端跑同一份
acquireSharedToken：第一个进程写，后来的复用。**没问题**——文件锁保护好了。

### 10.5 InstanceSpawner spawn 出来的 worker 知道自己 instanceId 吗？

现状：worker 启动时 `randomUUID()` 自己生成 instanceId。

新设计：broker 知道 instanceId（POST /api/instances 时生成 UUID 返给 webapp，
让 webapp 立即可以 `pushState('/i/<newId>/')`），所以**broker spawn worker 时
要把 instanceId 透传给 worker**——通过 env：`ATR_INSTANCE_ID=<uuid>` 或 CLI
arg。worker 启动检查 env，没有就 `randomUUID()`（兜底，比如用户手动 `atr
claude` 启的，broker 不参与 spawn）。

这条小改但容易漏，**写实现 todo**。

### 10.6 broker 端 SSE / file watcher 与 worker 自注册的时序

POST `/api/instances` → broker spawn worker 子进程 → broker **立即**返回？
还是等 worker 注册到 instances.json 之后再返回？

两种行为：

- **A. 立即返回**（带 `instanceId` + `pid`）：webapp 收到后 `pushState`，但 SPA
  pushState 后立刻 fetch `/i/<newId>/...` 可能 404（worker 还没 listen）。webapp
  靠 SSE 等"该 instanceId 出现在 instances.json"再激活。
- **B. 等就绪再返回**：broker file watcher 等 instances.json 含该 instanceId
  再返回 → webapp 一拿到响应就能用。

**B 更好**：用户体验是同步的"创建实例"，不需 webapp 端再做 polling 等就绪。
broker 等 worker 注册的超时跟 ensureBroker 等 broker.json 出现的超时同语义
（5s）；超时则返 504 + 杀 spawn 出来的 worker（避免脏状态）。

**结论**：选 B，POST /api/instances 同步等到就绪。

### 10.7 broker 端 InstanceSpawner 的 cliJsPath

broker 进程位于 backend/dist/broker/cli.js，spawn worker 时 `cliJsPath` 用同
一份 dist/cli.js。复用 `instance-spawner.ts` 的 `resolveEntry`（已经处理 dev
src/cli.ts + 生产 dist/cli.js）。这条复用现成代码，OK。

### 10.8 Push subscription endpoint 现在是 broker 根

§4.7 我说 push subscribe 在 broker 端，entryUrl = broker 根 URL（不带
`/i/<id>/`）。但**push 通知的语义**：

> Claude 等待审批 → 推送 → 用户点击通知 → 跳到正在等审批的那个实例

broker 根 URL 让 webapp 启动；但 webapp 启动后**默认 active 哪个实例**？
- 如果按"isCurrent"逻辑，可能不是用户期望的那个
- push 通知的 url 字段应该是**实例特定** URL：`http://broker/i/<id>/`

**结论**：每条订阅的 entryUrl 仍是实例特定的——但**不是订阅那一刻确定**，
而是**推送那一刻 worker 知道自己 instanceId 时拼**。

但 push 通知是 broker 发还是 worker 发？

- **0.6.x 现状**：worker 的 SessionController 检测到 hook 事件 → 调
  PushService.notifyAll（push payload 含实例特定 url）
- **新设计**：worker 仍检测 hook → 但 PushService 在 broker 端，worker 怎么
  通知 broker"该推送了"？

**两个方案**：

**方案 1**：worker 通过 broker 反代调一个 internal API `/api/push/notify`（loopback
only，broker 信任 worker 调）。

**方案 2**：PushService 实例两端各跑一份，共享 push-subscriptions.json + VAPID
keys 文件（worker 也持有 PushService instance，能直接 webPush.sendNotification）。
这其实是 0.7.0 现状——push-service.ts 自带文件持久化，两个进程都能 init。

**方案 2 更简单**：保留 push-service.ts 作为"library"——broker 用它处理 HTTP 路
由（subscribe/unsubscribe/vapid），worker 用它做 sendNotification（推送）。
push-subscriptions.json 由 broker 写，worker 读。

但**写入并发**——broker handle subscribe 写文件、worker readSubscriptions 缓存
到内存——worker 缓存怎么 invalidate？现在 PushService.init 一次性读，之后不再
重读。

**修法**：worker 端 PushService 在每次 notifyAll 前 reload 一次订阅文件（或
file watcher）。push 触发频率不高（claude 等审批 / turn failed），重读成本低。

**结论**：方案 2 + worker notifyAll 前 reload 订阅文件。这块改动较小。

### 10.9 broker 进程的 logger 输出

broker 是 detached 子进程，stdio: 'ignore' / 临时 fd。logger 默认 destination
是 stdout/stderr——broker 的 logger 写到哪？

- 0.7.0 现状：broker logger 默认 `silent` 在非 CLI 模式（看 logger.ts），但
  broker process **是** CLI 模式（cli.ts 设置了 CLI_MODE）。

需要 verify 一下 broker 进程的 logger 实际行为。**潜在问题**：broker 长期跑 +
log 写入 stdout，stdout 又被 ignore → 日志全丢。

**需要补**：broker 进程的 log 落到 `~/.atr/broker.log`（rotation 简单 = max 5MB
后 truncate；不引 pino-roll 之类重依赖）。

### 10.10 worker spawn 后 broker 怎么知道 worker pid？

POST `/api/instances` → broker spawn worker（detached + unref）→ child.pid
返回。broker 把 pid 暂存（按 instanceId）。

但 broker 进程崩溃 / 重启后，这些 pid 信息就丢了——worker 还在跑。下次 broker
启动如何知道哪些 pid 是它"曾经 spawn 的"？

**答**：broker **不需要**记住 spawn 历史。`instances.json` 已经记录每个 worker
的 pid（worker 自注册时填的）。broker DELETE `/api/instances/:id` 时直接读
instances.json 拿 pid → kill。broker 不需要维护 spawn 子进程表。

这条 OK，§4.4 表述要调整。

### 10.11 worker 端是否要保留 webapp 的 hard-reload / instance-info 等接口

`/api/instances/self/info` —— 0.6.x 时 webapp 用它确认"我连的就是这个 instance"。
0.7.0 broker 反代后 webapp 永远连"`/i/<id>/`"，instanceId 写在 URL 里，前端从
`document.baseURI` 解析即可，不再需要 worker 端 self-info。

**结论**：删（如果还有的话；要 grep 确认）。

### 10.12 worker 的 ws-authenticate 路径（attach `?token=`）

WS 鉴权两条路径：
- cookie session（webapp）→ 需 SessionsStore
- URL `?token=`（attach 客户端，用户手输 token 直连 worker）→ 需 verifyToken

attach 客户端走 `/i/<id>/ws?token=...` 经 broker 反代到 worker。**worker 仍能
验证**——AuthModule 在 worker 端保留了 verifyToken。OK。

### 10.13 v2 的 ADR 编号

design.md 列了 ADR-001 到 010。本次 v2 改动等同于"系统级 API 归属"决策，应该
新增 **ADR-011: API 归属划分**。

ADR-011 主要内容：
- broker 持有系统级 API；worker 仅 PTY/hook
- 决策原因（实测发现零 worker 时 webapp 完全不可用）
- 拒绝的替代方案：A. 完全在 worker（现状），B. instance-router 路径白名单
  （在 §8 选项 2 里讨论的），C. 两端都实现（双写）

**写实现 todo**：实施完后写 ADR-011 落档。

## 11. 终极清单（实施前确认）

按 §10 复审整理出来的最终决策清单——逐条确认：

| # | 决策 | 状态 |
|---|---|---|
| 1 | API 归属：broker 系统级 / worker 实例级 | ✓ §3 |
| 2 | 前端 fetch 改绝对路径 `/api/...`；WS 仍走 `/i/<id>/ws` | ✓ §8 选 1 |
| 3 | broker spawn 实例（不经 worker） | ✓ §4.4 |
| 4 | worker spawn 时通过 env `ATR_INSTANCE_ID` 透传 instanceId | **待补** §10.5 |
| 5 | POST /api/instances 同步等 worker 注册（5s 超时 + 失败 cleanup） | **待补** §10.6 |
| 6 | worker 仍持有 AuthModule（不挂 /api/auth，但用于 WS 鉴权） | **修正** §10.3 |
| 7 | 删 worker 端 /api/instances/self/shutdown / self/info（合并到 broker DELETE） | **新** §10.2 §10.11 |
| 8 | PushService 两端共用 library（broker 写 subscribe，worker 推 notify + reload） | **修正** §10.8 |
| 9 | broker 进程 log 落到 ~/.atr/broker.log（max 5MB rotation） | **新** §10.9 |
| 10 | broker 不维护 spawn 子进程表；DELETE 直读 instances.json 拿 pid | ✓ §10.10 |
| 11 | 不做 worker 兼容 stub（0.7.0 未 publish） | ✓ §5 |
| 12 | 实施完写 ADR-011 落档 | **新** §10.13 |

### 用户拍板结果（2026-05-10）

| # | 决策 | 选项 |
|---|---|---|
| 5 | POST /api/instances 创建语义 | **异步 pending + SSE 推就绪**（webapp 收到 202 + instanceId 后订阅 `/api/instances/stream` 等 ready 事件） |
| 9 | broker log rotation | **按天 rotate，保留 7 天**（pino-roll 或自定义；`broker-YYYY-MM-DD.log`） |
| 13 | dev 模式 vite 反代 | **broker 先于 vite 起，vite 反代 `/api` → :3000**（dev 启动顺序变成 `atr broker start` → `vite`） |

### 决策 5 实施细节（异步语义）

- POST /api/instances → broker 立即 spawn worker（detached + unref）→ 返回
  `202 Accepted` + body `{ instanceId, status: 'pending' }`
- broker 不阻塞等待 worker 注册；webapp 拿到 instanceId 后**继续订阅
  `/api/instances/stream` SSE**，等收到该 instanceId 的 `status: ready` 事件
  再 navigate 到 `/i/<id>/`
- worker 注册到 instances.json 时 broker 的 file watcher 自动触发 SSE 推送
  （现有机制即可）
- 失败兜底：spawn 后 30s 仍未在 instances.json 出现 → broker 主动 `kill(pid)`
  并通过 SSE 推 `status: failed`（避免脏 pending）。30s 远比 5s 宽松，覆盖
  cwd 复杂 / claude 冷启动场景

### 决策 9 实施细节（按天 rotate）

- 用 pino transport `pino/file` + 自定义 destination（每天 0 点切换文件名）
  或直接引 `pino-roll`（轻依赖，专门做这个）
- 文件命名：`~/.auvezy/terminal-remote/broker-2026-05-10.log`
- 保留 7 天（启动时扫一下目录，删除 7 天前的旧文件）
- 倾向：用 pino-roll，比手写 cron 简单，bundle 体积可接受

### 决策 13 实施细节（dev 流程）

- `pnpm dev` 改为先后顺序：先 `atr broker start`（detached）→ 再 `pnpm --filter
  frontend dev`（vite）
- 直接起 worker 的旧 dev 路径废弃；如果用户想 fork worker 调试可以单独
  `pnpm --filter backend dev` 但必须先有 broker
- vite proxy 配置不变（仍 target http://localhost:3000）；行为变成"vite → broker
  → worker"
- 文档 (CLAUDE.md / README) 更新 dev 启动说明

### 决策 7 verified（不需用户拍板）

grep 后确认 `/api/instances/self/shutdown` 不是 webapp 调的，是 backend
内部跨实例 stop 用（DELETE 时当前 worker 调目标 worker self/shutdown）。
新设计 broker 直接 `process.kill(pid, 'SIGTERM')`——worker 已经注册 SIGTERM
handler 走 graceful shutdown，**不需要 HTTP self/shutdown 中转**。一并删
instance-routes.ts 中的 `stopInstance(host, port, token)` 函数。

## 12. 决策落地

设计要点回放：

1. **broker 持有所有"系统级"状态与 API**：auth / config / instances / push /
   share / workdir / health / SSE
2. **worker 收窄到"PTY 实例 controller"**：health（探活）/ hook（loopback）/
   self-shutdown / WS
3. **前端 fetch 改回绝对路径 `/api/...`**（仅根 broker）；WS 仍走 `/i/<id>/ws`
4. **broker spawn 实例**（不通过任意 worker 中转）；instances.json 仍由 worker
   自注册
5. **完全切换**，不做 worker 兼容 stub（0.7.0 未 publish）

如果你认可这个方向，我接着拆 Sub-stage A-F 实施，先动 broker 端注入再迁路由。
