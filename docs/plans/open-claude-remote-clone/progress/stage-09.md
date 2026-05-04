# 阶段 9 进度：Web Push

## 目标

Claude 触发审批 hook 时，已订阅手机能在锁屏推送通知（即使 webapp 没在前台）。
iOS Safari < 16.4 不支持 Web Push 时降级到 LocalNotification。

## 验收标准

- VAPID 密钥三优先级：env > file > generate；写入 ~/.claude-remote/vapid.json
- GET /api/push/vapid 返回 publicKey（前端订阅用）
- POST /api/push/subscriptions：保存订阅
- DELETE /api/push/subscriptions：取消订阅
- HookReceiver notification → PushService 推送给所有订阅
- web-push 410 Gone → 自动清理过期订阅
- p256dh 长度异常 → 拒绝订阅（防御性）
- frontend service-worker.js 处理 'push' 事件 → 显示 notification
- frontend usePushNotification hook：检测支持 + 申请权限 + 订阅
- iOS 不支持时 useLocalNotification fallback：webapp 前台时 hook 触发本地通知

## 步骤清单

- [x] **9.1** backend/push/push-service.ts + 单测
- [x] **9.2** backend/api/push-routes.ts + 单测
- [x] **9.3** SessionController 接 PushService
- [x] **9.4** frontend public/service-worker.js + usePushNotification + useLocalNotification
- [x] **9.5** router 注入 + index.ts 注入 + ConsolePage 接订阅按钮
- [x] **9.6** 端到端 smoke
- [x] **9.7** ADR 008 + 收尾

## 实施日志

### 9.1 push-service ✅

- `backend/src/push/push-service.ts`：VAPID 三级链（env > file > generate），
  订阅持久化 `~/.claude-remote/push-subscriptions.json`，原子写
- `notifyAll`：错误中遇 410 / 404 自动从订阅集合中删除
- `subscribe`：p256dh 长度 80~100、auth 16~32 防御校验
- 依赖注入 `env` + `pushImpl`，便于测试
- `push-service.test.ts`：10 单测全过（init 三链路 / subscribe 校验 / notifyAll prune）

### 9.2 push-routes ✅

- `backend/src/api/push-routes.ts`：
  - GET /api/push/vapid → public，返回 publicKey
  - POST /api/push/subscriptions → requireAuth，注册订阅
  - DELETE /api/push/subscriptions → requireAuth，移除订阅
- `push-routes.test.ts`：6 单测覆盖未登录 / 已登录 / 缺字段三类

### 9.3 SessionController 接 PushService ✅

- 新增 `setPushService(push, context)` setter
- `onHookNotification` 中收到 status='waiting_input' 时调 `pushService.notifyAll`
- 通知 payload 含 `title`, `body`, `url`（指向 publicUrl，让 SW 点击直达）

### 9.4 service-worker + hooks ✅

- `frontend/public/service-worker.js`：
  - install / activate：skipWaiting + clients.claim
  - push 事件：showNotification（tag='claude-approval', renotify）
  - notificationclick：focus 已有 tab 或 openWindow
- `frontend/src/services/push-api.ts`：fetchVapidPublicKey / postSubscription / deleteSubscription
- `frontend/src/hooks/usePushNotification.ts`：检测 + 注册 + 订阅 + DELETE 路径
- `frontend/src/hooks/useLocalNotification.ts`：webapp 前台时的 fallback
- `frontend/src/components/common/PushToggle.tsx`：UI 切换

### 9.5 router + index + ConsolePage ✅

- `backend/src/api/router.ts`：新增 `pushService?` option，挂载 push-routes
- `backend/src/index.ts`：1.9 步初始化 PushService；setPushService 注入；
  传入 createApiRouter
- `frontend/src/pages/ConsolePage.tsx`：`<PushToggle />` 与 StatusBar 同行；
  status_update='waiting_input' 时 localNotify.notify 兜底
- `global.css`：`.console-page__bar`（StatusBar + PushToggle 同行）

### 9.6 smoke ✅

- `backend/scripts/smoke-stage9.mjs`：5 项端到端
  1. GET /api/push/vapid → publicKey 长度 87
  2. 未登录 POST → 401（auth 中间件挡住）
  3. 已登录 POST → 200（伪 subscription，不真发送）
  4. 二次 GET → publicKey 稳定（vapid.json 持久化）
  5. DELETE → removed=true
- 端口 3193 测试后已释放，HOME 临时目录已清理

### 9.7 阶段收尾 ✅

- ADR 008（VAPID 三级优先级）已写
- backend typecheck + 284 单测 + frontend typecheck + frontend build 全过

## 当前阻塞

无。

## 验证结果

- backend 测试：284 / 284 全过
- frontend typecheck / build：通过（dist 631 KB / gzip 173 KB）
- smoke-stage9：5 / 5 全过
- 端口与临时 HOME 已释放
