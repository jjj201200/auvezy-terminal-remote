# ADR-011: API 归属重划分（broker = 系统级 / worker = 实例级）

## 状态

已采纳（2026-05-10）

## 上下文

0.7.0 阶段 1-7 实施完成后，实测发现一个架构层面的 bug：

- broker-only 状态（用户开机但没起任何 worker）下，浏览器访问 broker 看到 webapp，
  但所有 `/api/*` 调用返回 404 → 无法登录、无法看到实例列表、无法创建实例
- 原因：阶段 3 设计 `instance-router` 时**默认所有 `/api/*` 都属于某个 worker**，
  broker 仅做反代 + 静态资源。零 worker 时根 `/api/*` 没人响应

这与"broker 永驻"（ADR-002）的初衷不一致：用户期望 broker 在线即可使用 webapp，
不需要先在终端里起一个 worker 才能登录。

design.md 没有明确划分谁负责哪类 API；阶段 3 把整个 router 原样保留在 worker 端是
错误的。

## 决策

**API 按"全局 vs 实例特定"重新归属**：

| 类别 | 路径 | 归属 | 理由 |
|---|---|---|---|
| 系统级 / 全局 | `/api/auth` | broker | cookie 写在 broker origin |
| | `/api/config` | broker | 用户配置文件全局共享，与具体 worker 无关 |
| | `/api/instances`（GET / POST / DELETE / SSE） | broker | 实例生命周期跨 worker；零 worker 时仍要可用 |
| | `/api/push/*` | broker | VAPID + 订阅文件全局共享 |
| | `/api/share/endpoints` | broker | broker 才知道自己监听 host 集合 |
| | `/api/workdir-policy` | broker | 全局策略 |
| 实例特定 | `/api/health` | both | broker 自己一份，worker 一份给反代探活 |
| | `/api/hook` | worker only | claude hook 必须 loopback only，仅 worker 可达 |
| | WebSocket `/ws` | worker only | PTY IO，与具体实例绑定 |

**前端 fetch 路径**：所有 `/api/*` 改绝对路径直命 broker 根（`/api/auth` 等），
不再走 `/i/<id>/api/...` 反代。WebSocket 仍走 `/i/<id>/ws`（实例特定）。

**实例创建语义**：POST `/api/instances` 改异步——立即返回 202 + `{ instanceId,
status: 'pending' }`，webapp 通过 SSE `/api/instances/stream` 等到 worker 自注册
到 instances.json 即视为 ready。30s 超时 broker 主动 SIGTERM 兜底，避免脏 pending。

**worker 收窄**：worker 不再持有 InstanceSpawner / ConfigStore / PushService writer /
frontendDist 静态服务；仅保留 PtyManager + WsServer + AuthModule（用于 WS 鉴权）+
PushService reader（hook 触发时 reload 订阅文件再 sendNotification）。

**broker spawn 实例**：broker 在 POST `/api/instances` 时 spawn worker 子进程，
通过 env `ATR_INSTANCE_ID` 透传 broker 预生成的 instanceId，让 webapp 立刻拿到 id 能
订阅 SSE 并切换到 `/i/<id>/`。

**broker DELETE 直接 SIGTERM**：不再走 HTTP self-shutdown 中转——worker 已注册
SIGTERM handler 走 graceful shutdown，跨实例 stop 一律由 broker `process.kill`。

## 理由

1. **API 归属与 broker 永驻语义对齐**：用户期望"broker 在线 = webapp 可用"，
   系统级 API 必须在 broker 端
2. **零 worker 时仍可用**：登录 / 列实例 / 创建实例都不需要先有 worker
3. **多实例场景更对**：原方案下 webapp 通过"当前 worker"代理跨实例操作（如关闭
   instance B），broker 才是真正的协调者
4. **前端架构简化**：`/api/*` 永远命中 broker → 单 PWA 模型与单 origin 完全一致；
   WebSocket 才需要 instanceId 路径
5. **异步语义匹配 spawn 真实耗时**：cwd 复杂 / claude 冷启动可能 > 5s，同步等就
   绪超时不够；异步 + SSE 推 ready 解决了这个问题

## 拒绝的替代方案

**A. 完全保留在 worker（现状）**：零 worker 时不可用——已被实测推翻。

**B. instance-router 路径白名单**：让 `/i/<id>/api/auth` 等 broker 自己处理（忽
略 instanceId）。语义混乱，"任何 instanceId 下都能登录"对用户心智模型不友好；
broker 还要维护一份白名单跟 worker 路由对齐。

**C. 两端都实现（双写）**：违反 SSOT。订阅 / 配置等如果 broker 与 worker 都写，
并发冲突难解。

**D. POST /api/instances 同步等就绪**：5s 超时太紧，30s 让 fetch 卡住 30s 体验
差（loading spinner 无意义阻塞）；异步 + SSE 是更标准的做法。

## 后果

**好的影响**：

- 零 worker 时 webapp 完全可用（登录 → 创建实例 → SSE 等就绪 → navigate）
- broker 是唯一系统级 API entry point，CORS / cookie / rate-limit 集中管理
- worker 极简，只剩 PTY + hook + WS，更容易 unit test
- 前端 fetch 路径与 base href 解耦——绝对 `/api/*` 不依赖 `<base href>`

**代价**：

- broker 进程从"无状态反代"升级为"持久状态进程"（持有 SessionsStore /
  PushService 内存缓存 / instances watcher），但所有状态都是文件落盘 + 进程内缓
  存，broker 重启后从文件恢复，与 ADR-002 一致
- broker 进程 log 必须落盘（之前 broker 没什么日志）—— 加 daily-rotate
  `~/.auvezy/terminal-remote/broker-YYYY-MM-DD.log`，保留 7 天
- dev 流程变化：`pnpm dev` 不再单独起 worker 跑 webapp；必须先 `atr broker start`
  再 `vite`（vite proxy 不变，仍指 :3000，但目标变成 broker 而不是 worker）
- 0.7.0 alpha 期间发到的少量 client：旧前端调 `/i/<id>/api/auth` → broker 反代
  到 worker → 404；SW 在第一次失败后 update 加载新 webapp（指向 broker 根）。
  阶段 7 已 publish 但用户量极小，不做兼容 stub
- worker spawn 的子进程仍走 detached + unref（与 0.7.0 阶段 1 一致），broker
  重启不影响已 spawn 的 worker

## 实施切片

按 sub-stage 切：

| Sub | 内容 | 文件 |
|---|---|---|
| A | createApiRouter 拆成 createBrokerApiRouter / createWorkerApiRouter | api/router.ts |
| B | broker-server 接受 brokerApi 注入；broker/cli.ts 装配 AuthModule/SessionsStore/InstanceSpawner/PushService/ConfigStore | broker/broker-server.ts、broker/cli.ts |
| C | broker 启动复用 acquireSharedToken | broker/cli.ts |
| D | worker 收窄：删 frontendDist / 全局 API / PushService writer | index.ts |
| E | 前端 fetch 改绝对路径；POST /api/instances 改异步 202；SSE 等 ready | services/api-client.ts、services/instance-api.ts、hooks/useInstances.ts |
| F | broker 进程 daily-rotate log + worker PushService.reloadSubscriptions before notify | broker/broker-log-rotator.ts、push/push-service.ts |
| G | 测试调整：broker instance-routes、broker-log-rotator；vite proxy 加 /i/ 反代 | api/instance-routes.test.ts、broker/broker-log-rotator.test.ts、vite.config.ts |
| H | ADR + progress 文档落档 | docs/plans/path-routing/adrs/011-api-ownership.md、progress/08-阶段8-api-ownership.md |

## 关联

- design-v2-api-ownership.md（设计草稿）
- ADR-001（broker / worker 分离）
- ADR-002（broker 永驻）
- ADR-009（worker loopback only）
