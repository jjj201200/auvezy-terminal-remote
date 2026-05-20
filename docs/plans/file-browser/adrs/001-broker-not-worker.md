# ADR-001: 文件 API 挂 broker,不挂 worker

## 状态

已采纳(2026-05-20)

## 上下文

0.7.0 v2(path-routing ADR-011)起 broker 与 worker 职责严格拆分:
- broker 持有"系统级"`/api/*`:auth / config / instances / workdir-policy / share / push;
- worker 仅持有"实例级":`/api/health` / `/api/hook` / `/ws`。

文件浏览功能需要访问宿主机 FS。FS 是机器级资源,不专属任何实例进程。要决定新 `/api/files/*` 归 broker 还是 worker。

## 决策

**挂 broker。**路径为 `/api/files/...`(无 `/i/<id>` 前缀),`instanceId` 通过 query 显式传入。

## 拒绝的替代方案

### 方案 A:挂 worker(经反代访问 `/i/<id>/api/files/...`)

理由听起来合理(实例上下文带 instanceId 隐式),但代价:
1. **破坏 v2 拆分**:worker 重新需要 AuthModule、workdir-policy 快照,变重;
2. **每实例重复实现**:同一台机的 5 个实例各自能列同一份 FS,意义不大;
3. **多机场景反逻辑**:跨机场景下,worker 持有"远程机的 FS",但 web 用户预期看到"broker 所在机的 FS";instance/broker 同机时这两者重合,跨机时混淆。

### 方案 B:独立 `atr-fileserver` 进程

over-engineering。新增进程引入新生命周期管理、新端口、新 IPC,不值。

## 理由

1. broker 已有鉴权 + workdir-policy 快照,零增量基础设施成本;
2. 与 `/api/workdir-policy` 同源,语义一致("FS 边界由 broker 守");
3. 不破坏 worker 极简原则(v2 ADR-011 决议);
4. `instanceId` 通过 query 显式传 → 路由仍能按"哪个实例发起"做审计 / 派生 base cwd。

## 后果

- ✅ worker 路由表保持不变,代码无需碰;
- ✅ 鉴权/policy 复用零成本;
- ⚠️ `instanceId` 必须显式传 query,前端在调 fetch 时要带上(可在 `useFiles` hook 里统一注入);
- ⚠️ broker 进程承担更多 IO(list / read / search),需关注 event loop 阻塞——本设计已通过 `fs.promises` + readline 流式 + 单文件 100 ms 预算缓解。
