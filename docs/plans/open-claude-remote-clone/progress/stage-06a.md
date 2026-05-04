# 阶段 6a 进度：多实例（后端）

## 目标

让一台机器并发跑多个 claude-remote 实例（不同项目），相互不冲突端口、共享 token、注册表自洽。

## 验收标准

- [x] 不同实例端口互不冲突（DEFAULT_PORT 被占 → 自动 +1，最多 PORT_FINDER_MAX_ATTEMPTS 次）
- [x] 启动写入 ~/.claude-remote/instances.json；注册表用 mkdir-lock 串行
- [x] 注册表里 pid 已不存活的"僵尸"项启动期被清理（不暴露给前端）
- [x] GET /api/instances 返回当前用户所有活实例 + isCurrent 标记
- [x] POST /api/instances（headless 派生）：选 cwd 后启动新实例，新进程自注册
- [x] claude-remote stop [pattern]：把匹配项 SIGTERM；超时后 SIGKILL
- [x] Cookie 名后缀绑端口（已在阶段 2 实现，本阶段补端到端验证）

## 步骤清单

- [x] **6a.1** backend/registry/port-finder.ts + 6 单测
- [x] **6a.2** backend/registry/instance-registry.ts（注册/注销/列表/僵尸清理）+ 11 单测
- [x] **6a.3** backend/api/instance-routes.ts（GET /api/instances）+ 5 集成单测
- [x] **6a.4** backend/registry/instance-spawner.ts + POST /api/instances（已合并 6a.3 commit）
- [x] **6a.5** backend/registry/stop-instances.ts + cli-stop / cli-list + 5 单测
- [x] **6a.6** index.ts 集成（auto port + 注册 + 进程退出注销）+ router 注入 instance-routes
- [x] **6a.7** 端到端 smoke + ADR 003 + 收尾

## 实施日志

### 6a.1 port-finder
- findAvailablePort 递增探测，maxAttempts 用尽抛 InstanceError(PORT_UNAVAILABLE, 503)
- probePort 内部 createServer + listen 试探；注入便于测试
- 6 单测覆盖各路径

### 6a.2 instance-registry
- InstanceRegistryManager 三大操作：list / register（upsert）/ unregister
- 全部读写包在 withFileLock 内串行
- list/unregister 自动剔除 pid 已死的项 + 同步落盘
- schema unknown / JSON 损坏 → 视为空（防御性）
- atomicWrite（tmp + rename）；目录 0o700、文件 0o600
- isPidAlive 工具函数
- 11 单测：list 空 / register / upsert / unregister / 僵尸自清 /
  schema unknown / JSON 损坏 / 5 路并发 race-free / pid 探测三场景

### 6a.3 + 6a.4 instance-routes + spawner
- ConfigStore-style 注入：路由不直接持有 spawner 实现
- GET /instances + isCurrent 标记
- POST /instances：body.cwd 校验 + InstanceSpawner.spawn
- spawner 未注入时 POST 返回 501
- DefaultInstanceSpawner：child_process.spawn cli.js + detached + unref，
  父退出后子进程仍存活；INSTANCE_NAME 通过 env 透传
- 5 集成单测覆盖鉴权 / list / spawn / 缺 cwd / 缺 spawner

### 6a.5 stop-instances + CLI 子命令
- stopInstances(pattern?, opts?)：substring 匹配 name/cwd/host:port
- 流程：SIGTERM → 轮询 graceMs → 仍存活则 SIGKILL
- 不论结果都 unregister 注册表条目
- StopResult.outcome ∈ sigterm | sigkill | gone | failed
- cli-utils 增加 stopPattern 字段
- cli.ts 子命令分发：list / stop（attach 仍留待阶段 7）
- 5 单测：空列表 / dead pid / 真实子进程 SIGTERM 优雅退出 /
  真实子进程忽略 SIGTERM 后 SIGKILL / 不匹配 pattern 不影响其它

### 6a.6 index 集成
- 启动序列 1.7：findAvailablePort（preferred 被占自动 +1）
  + 生成 instanceId（randomUUID）
- 注册表 + DefaultInstanceSpawner 注入到 router
- listen 回调内 register；shutdown 内 best-effort unregister

### 6a.7 阶段收尾
- ⚠ 实施过程发现并修正 file-lock 死等 bug：
  - 旧逻辑要求 mtime > staleMs **且** pid 不存活才回收 → 持锁进程被 SIGKILL
    后下个用户要等 staleMs 才能拿到
  - 新逻辑：pid 不存活立即回收（不必等 mtime）；mtime 仅在拿不到 pid 时兜底
  - file-lock.test.ts 同步更新（仍 7 项全过）
- ADR 003 Cookie 名后缀绑端口写入
- backend/scripts/smoke-stage6a.mjs：HOME 隔离 + 5 项验收：
  1) instance A 起在 3195
  2) instance B 也 preferred=3195 → 自动 3196
  3) GET /instances 见 A+B；B isCurrent=true
  4) POST /instances 派生 derived（cwd=tmpHome）→ list 含 3 条
  5) claude-remote stop derived → list 回到 2 条

## 当前阻塞

无。

## 验证结果

- ✅ typecheck（shared/backend/frontend）干净
- ✅ 单测 237 backend + 15 shared 通过（本阶段新增 27 单测：
  port-finder 6 + instance-registry 11 + instance-routes 5 + stop-instances 5）
- ✅ stage-06a smoke 5/5 通过
- ✅ ADR 003 cookie 名端口绑定已记录
- ✅ 端口 / 临时目录释放
