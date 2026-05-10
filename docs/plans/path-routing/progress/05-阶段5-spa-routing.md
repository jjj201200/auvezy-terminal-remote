# 阶段 5 — SPA 内部路由切实例

> 状态：✅ 已完成（2026-05-10）；未 commit
> 阶段 4 已落地：broker 反代 SPA + base href 注入完整工作。
> 阶段 5 目标：把"切实例 = 跨 port 跳转 + 重新加载 SPA"换成"history.pushState
> 改 URL，SPA 内部 state 切换"。

## 目标

1. SPA 启动时从 `location.pathname` 解析 `/i/<id>/` 作为初始 activeId
2. 切实例改用 `history.pushState('/i/<targetId>/')`，URL 变 + activeId 变 +
   InstanceView 重 mount，**不重新加载 SPA**
3. `popstate`（浏览器前进/后退）监听 → 同步 activeId
4. 删除跨 port location.assign 的 `buildInstanceUrl` / `buildWsUrl` 跨实例
   token 拼接逻辑（0.7.0 所有实例同 origin 同 cookie）
5. `killAfterSwitch` 流程改 SPA 内：切到新实例 + DELETE 老实例（同源）

## 切片

| Sub | 内容 | 风险 |
|---|---|---|
| 5A | 解析 location.pathname 初始化 activeId；popstate 监听 | 低 |
| 5B | setActiveId 改写 URL；删跨 port 跳转代码；buildWsUrl 简化 | 中 |
| 5C | 前端单测 + 手测 F5 / 切换 / 浏览器 back | 中 |

## 任务清单

### 5A — 读 URL

- [ ] `frontend/src/utils/instance-path.ts`：`getInstanceIdFromLocation()` 从
      `location.pathname` 提取 `/i/<id>/` 中的 id；无则 null
- [ ] MultiInstanceConsole 初始化 activeId 优先用 URL 推断
- [ ] popstate listener：URL 变 → 同步 activeId
- [ ] 单测 instance-path

### 5B — 切实例改 pushState

- [ ] `setActiveInstance(id)`：内部 `history.pushState(null, '', '/i/${id}/')`
      + `setActiveId(id)`
- [ ] InstanceTabs handleSwitch / handleCloseRequest：跨 port 跳转代码删
- [ ] buildWsUrl 简化为同源默认（每个实例都通过 `/i/<id>/ws` 走 broker）
- [ ] killAfterSwitch：原本 URL search param + location.assign，改成 SPA 内
      DELETE 老实例后 setActiveInstance 切 tab

### 5C — 验证

- [ ] frontend 测试 instance-path / setActiveInstance pushState 调用
- [ ] 手测：F5 刷新 `/i/<id>/` → activeId 仍是该 id
- [ ] 手测：切实例 → URL 变化 + 不刷新页面
- [ ] 手测：浏览器后退/前进 → activeId 跟随

## 与 design.md 对应

- §3 决策 5（单 PWA）→ 整阶段
- §9 SPA 内部路由 → 5A/5B
- §10 迁移：用户 0.6.x 时分享的 LAN URL 失效（已在阶段 2 breaking note 写过）

## 进度日志

### 2026-05-10 — 开工

写本文档。

### 2026-05-10 — 5A 完成

- frontend/utils/instance-path.ts：`getInstanceIdFromPath(path?)` /
  `buildInstancePath(id)` / `pushInstancePath(id)` 三个 helper
- MultiInstanceConsole.tsx：activeId useState 用 `getInstanceIdFromPath()`
  做初始值；popstate listener 同步 activeId 跟 URL 变化（浏览器 back/forward）
- 10 个新单测覆盖（含正负 path、buildInstancePath、pushInstancePath spy）

### 2026-05-10 — 5B 完成

- handleSwitch 改为 `pushInstancePath(id) + setActiveId(id)`
- handleCloseRequest 关闭当前实例：原本 location.assign 跳到另一实例（带
  `killAfterSwitch` URL 参数）→ 现在 SPA 内 `handleSwitch + removeInstance`
  同源完成
- buildWsUrl 签名从 `(host, port)` 改为 `(instanceId)`，返回
  `${proto}//${host}/i/${id}/ws`
- 删 buildInstanceUrl / loadToken import（已无人用）
- killAfterSwitch URL 兼容 effect 保留（0.6.x 已分发的 URL 用户仍能用）

### 2026-05-10 — 5C smoke 通

- frontend 66/66（+10 instance-path）；frontend build 成功
- 后端链路 smoke：HTML 注入 + asset 反代 + /api/auth + WS `/i/<id>/ws` 全通
- 全 workspace：backend 481 + frontend 66 = 547/547 全绿；build 零错
