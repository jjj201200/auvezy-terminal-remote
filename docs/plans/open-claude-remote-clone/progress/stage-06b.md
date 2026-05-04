# 阶段 6b 进度：多实例（前端 + Web 创建）

## 目标

前端能看到、切换、创建、停止多个 claude-remote 实例。

## 验收标准

- 顶部 InstanceTabs 显示当前用户所有活实例
- 点击非当前实例 → 浏览器跳到该实例的 URL（同 IP 不同端口）
- 「+」按钮打开 CreateInstanceModal 输入 cwd / name → POST /api/instances
- 创建成功后 5s 内 InstanceTabs 自动刷新出现新实例
- 当前实例标签可点「×」停止（与 /api/instances DELETE 或 stop CLI 行为一致）

## 步骤清单

- [ ] **6b.1** frontend/services/instance-api.ts（GET/POST/DELETE /api/instances）
- [ ] **6b.2** frontend/stores/instance-store.ts + hooks/useInstances（轮询 + 缓存）
- [ ] **6b.3** components/instances/InstanceTabs.tsx
- [ ] **6b.4** components/instances/CreateInstanceModal.tsx
- [ ] **6b.5** ConsolePage 接 InstanceTabs + 创建按钮
- [ ] **6b.6** 端到端 smoke + 收尾

## 实施日志

### 6b.1 instance-api
（待开始）

### 6b.2 instance-store
（待开始）

### 6b.3 InstanceTabs
（待开始）

### 6b.4 CreateInstanceModal
（待开始）

### 6b.5 ConsolePage 集成
（待开始）

### 6b.6 阶段收尾
（待开始）

## 当前阻塞

无。

## 验证结果

（阶段完成后填写）
