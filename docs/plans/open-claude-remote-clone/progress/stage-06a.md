# 阶段 6a 进度：多实例（后端）

## 目标

让一台机器并发跑多个 claude-remote 实例（不同项目），相互不冲突端口、共享 token、注册表自洽。

## 验收标准

- 不同实例端口互不冲突（DEFAULT_PORT 被占 → 自动 +1，最多 PORT_FINDER_MAX_ATTEMPTS 次）
- 启动写入 ~/.claude-remote/instances.json；注册表用 mkdir-lock 串行
- 注册表里 pid 已不存活的"僵尸"项启动期被清理（不暴露给前端）
- GET /api/instances 返回当前用户所有活实例 + isCurrent 标记
- POST /api/instances（headless 派生）：选 cwd 后启动新实例，新进程自注册
- claude-remote stop [pattern]：把匹配项 SIGTERM；超时后 SIGKILL
- Cookie 名后缀绑端口（已在阶段 2 实现，本阶段补端到端验证）

## 步骤清单

- [ ] **6a.1** backend/registry/port-finder.ts + 单测
- [ ] **6a.2** backend/registry/instance-registry.ts（注册/注销/列表/僵尸清理）+ 单测
- [ ] **6a.3** backend/api/instance-routes.ts（GET /api/instances）+ 单测
- [ ] **6a.4** backend/registry/instance-spawner.ts + POST /api/instances + 单测
- [ ] **6a.5** backend/registry/stop-instances.ts + cli.ts stop 子命令 + 单测
- [ ] **6a.6** index.ts 集成（auto port + 注册 + 进程退出注销）+ router 注入 instance-routes
- [ ] **6a.7** 端到端 smoke + ADR 003 + 收尾

## 实施日志

### 6a.1 port-finder
（待开始）

### 6a.2 instance-registry
（待开始）

### 6a.3 instance-routes
（待开始）

### 6a.4 instance-spawner
（待开始）

### 6a.5 stop-instances
（待开始）

### 6a.6 index 集成
（待开始）

### 6a.7 阶段收尾
（待开始）

## 当前阻塞

无。

## 验证结果

（阶段完成后填写）
