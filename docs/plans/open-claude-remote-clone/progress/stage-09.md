# 阶段 9 进度：Web Push

## 目标

Claude 触发审批 hook 时，已订阅手机能在锁屏推送通知（即使 webapp 没在前台）。
iOS Safari < 16.4 不支持 Web Push 时降级到 LocalNotification。

## 验收标准

- VAPID 密钥三优先级：env > file > generate；写入 ~/.claude-remote/vapid-keys.json
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

- [ ] **9.1** backend/push/push-service.ts + 单测
- [ ] **9.2** backend/api/push-routes.ts + 单测
- [ ] **9.3** SessionController 接 PushService
- [ ] **9.4** frontend public/service-worker.js + usePushNotification + useLocalNotification
- [ ] **9.5** router 注入 + index.ts 注入 + ConsolePage 接订阅按钮
- [ ] **9.6** 端到端 smoke
- [ ] **9.7** ADR 008 + 收尾

## 实施日志

### 9.1 push-service
（待开始）

### 9.2 push-routes
（待开始）

### 9.3 SessionController 接 PushService
（待开始）

### 9.4 service-worker + hooks
（待开始）

### 9.5 router + index + ConsolePage
（待开始）

### 9.6 smoke
（待开始）

### 9.7 阶段收尾
（待开始）

## 当前阻塞

无。

## 验证结果

（阶段完成后填写）
