# 阶段 8 进度：IP 漂移 + ANSI 过滤

## 目标

- LAN IP 变化（如笔记本切换 Wi-Fi）时，自动通知前端，让用户重新扫码或更新书签
- 过滤 Claude 进入/退出"备用屏幕（alternate screen）"时清屏，让网页端历史不丢

## 验收标准

- AnsiFilter 能识别 \x1b[?1049h（进 alt screen）/ \x1b[?1049l（退）
- 跨 chunk 拼接：\x1b 在一 chunk 末尾、[?1049h 在下一 chunk 开头也能正确识别
- 启用过滤时 alt screen 内的输出被 drop，不进 OutputBuffer，也不广播
- IpMonitor 30s 轮询；连续 N 次新 IP 才触发回调（抖动忽略）
- 触发回调时广播 ip_changed WS 消息含 oldIp/newIp/newUrl
- 前端收到 ip_changed → 显示 IpChangeToast，提示用户切换书签

## 步骤清单

- [ ] **8.1** backend/utils/ansi-filter.ts + 单测
- [ ] **8.2** SessionController 集成 ansi-filter + 单测
- [ ] **8.3** backend/utils/ip-monitor.ts + 单测
- [ ] **8.4** frontend useWebSocket 处理 ip_changed
- [ ] **8.5** frontend components/common/IpChangeToast
- [ ] **8.6** index.ts 接 ip-monitor + ConsolePage 接 IpChangeToast
- [ ] **8.7** 端到端 smoke + ADR 007 + 收尾

## 实施日志

### 8.1 ansi-filter
（待开始）

### 8.2 SessionController 集成
（待开始）

### 8.3 ip-monitor
（待开始）

### 8.4 useWebSocket
（待开始）

### 8.5 IpChangeToast
（待开始）

### 8.6 index 集成 + ConsolePage
（待开始）

### 8.7 阶段收尾
（待开始）

## 当前阻塞

无。

## 验证结果

（阶段完成后填写）
