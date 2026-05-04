# 阶段 6b 进度：多实例（前端 + Web 创建）

## 目标

前端能看到、切换、创建多个 claude-remote 实例。

## 验收标准

- [x] 顶部 InstanceTabs 显示当前用户所有活实例
- [x] 点击非当前实例 → 浏览器跳到该实例的 URL（同 IP 不同端口）
- [x] 「+」按钮打开 CreateInstanceModal 输入 cwd / name → POST /api/instances
- [x] 创建成功后 5s 内 InstanceTabs 自动刷新出现新实例（轮询 + 立即触发 reload）

## 步骤清单

- [x] **6b.1** frontend/services/instance-api.ts（GET/POST /api/instances）
- [x] **6b.2** frontend/hooks/useInstances（轮询 + 缓存 + 创建）
- [x] **6b.3** components/instances/InstanceTabs.tsx
- [x] **6b.4** components/instances/CreateInstanceModal.tsx
- [x] **6b.5** ConsolePage 接 InstanceTabs + CreateInstanceModal
- [x] **6b.6** 端到端 smoke + 收尾

## 实施日志

### 6b.1 instance-api
- fetchInstances / createInstance 两个调用，复用阶段 4 的 apiGet/apiPost

### 6b.2 useInstances
- 首次挂载 + 5s 轮询；保留上次成功值不被失败破坏
- create(cwd, name?) 触发 POST + 立即 reload（即便派生进程稍后注册也能很快被轮询命中）
- status=0（网络瞬断）不显示错误，避免 toast 闪烁

### 6b.3 InstanceTabs
- 跨端口跳转用 window.location.assign（不同 origin 无法 react-router）
- 跳转 URL 不带 token；目标实例 cookie 由 useAuth 用本地 token 自动重认证
- 当前实例 disabled + 视觉 active；末尾「+」按钮触发外层 onCreateClick

### 6b.4 CreateInstanceModal
- cwd 必填 + name 可选
- 失败友好提示"检查 cwd 是否存在"，不直接显示后端错误码
- 复用 settings-modal__* 类名，统一观感

### 6b.5 ConsolePage 集成
- 顶部插 InstanceTabs；维护 createOpen state；挂 CreateInstanceModal
- onSubmit 直接接 useInstances.create 返回 boolean

### 6b.6 阶段收尾
- backend/scripts/smoke-stage6b.mjs：起 backend → 4 项验收
  1) GET / 返回含 #app 容器的 SPA index
  2) /assets/index-*.js 能 GET 到
  3) JS bundle 含中文文案 '创建新实例' / '实例切换'（验证多实例 UI 已编译进去）
  4) GET /api/instances 当前实例 host 是私有/loopback IP
- 全程 HOME 隔离 + 完整清理

## 当前阻塞

无。

## 验证结果

- ✅ typecheck（shared/backend/frontend）干净
- ✅ 单测 237 backend + 15 shared 维持（本阶段未新增单测，UI 测试留待 e2e）
- ✅ stage-06b smoke 4/4 通过
- ✅ 端口 / 临时目录释放
