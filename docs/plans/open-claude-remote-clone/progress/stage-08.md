# 阶段 8 进度：IP 漂移 + ANSI 过滤

## 目标

- LAN IP 变化（如笔记本切换 Wi-Fi）时，自动通知前端，让用户重新扫码或更新书签
- 过滤 Claude 进入/退出"备用屏幕（alternate screen）"时清屏，让网页端历史不丢

## 验收标准

- [x] AnsiFilter 能识别 \x1b[?1049h（进 alt screen）/ \x1b[?1049l（退）
- [x] 跨 chunk 拼接：\x1b 在一 chunk 末尾、[?1049h 在下一 chunk 开头也能正确识别
- [x] 启用过滤时 alt screen 内的输出被 drop，不进 OutputBuffer，也不广播
- [x] IpMonitor 30s 轮询；连续 N 次新 IP 才触发回调（抖动忽略）
- [x] 触发回调时广播 ip_changed WS 消息含 oldIp/newIp/newUrl
- [x] 前端收到 ip_changed → 显示 IpChangeToast，提示用户切换书签

## 步骤清单

- [x] **8.1** backend/utils/ansi-filter.ts + 10 单测
- [x] **8.2** SessionController 集成 ansi-filter（默认 ON）+ 2 单测
- [x] **8.3** backend/utils/ip-monitor.ts（轮询 + 稳定阈值）+ 7 单测
- [x] **8.4** frontend useWebSocket 处理 ip_changed
- [x] **8.5** frontend components/common/IpChangeToast
- [x] **8.6** index.ts 接 ip-monitor + 启动期实例化 + shutdown stop
- [x] **8.7** 端到端 smoke + ADR 007 + 收尾

## 实施日志

### 8.1 ansi-filter
- 状态机 normal ↔ alt
- 跨 chunk pending：ESC 落在前 chunk 末时挂 pending
- alt 期间 drop 内容；进入/退出序列本身保留
- 10 单测覆盖各路径 + 嵌套 ESC 不误识别 + reset

### 8.2 SessionController 集成
- ansiFilter 默认 ON；可通过 ansiFilter:false 关闭
- PC stdout 始终用原始数据；OutputBuffer + WS 广播用过滤后数据
- 2 单测：默认过滤 / 关闭过滤分支

### 8.3 ip-monitor
- 30s 轮询 detectDisplayIp；连续 N 次新 IP 才触发
- 抖动（A→B→A）不触发
- detect 抛错静默忽略
- timer.unref() 不阻塞 event loop
- 7 单测覆盖各分支

### 8.4-8.5 前端
- useWebSocket 已能识别 ip_changed（msg union 已含）
- ConsolePage 接 ipChange state；收到 ip_changed → setIpChange
- IpChangeToast：底部黄色横条 + 「复制链接」+「关闭」；不自动消失
  （IP 漂移是用户必须响应的事件）
- global.css 补 ip-change-toast__* 样式

### 8.6 index 集成
- 1.8 步实例化 IpMonitor（initialIp=displayIp, hostHint=cfg.host）
- listen 回调内 onChange → broadcast ip_changed（含 newUrl 用 buildPublicUrl）
- shutdown 内 ipMonitor.stop()

### 8.7 阶段收尾
- ADR 007 启用 AlternateScreenFilter 决策（与上游不同）已记录
- backend/scripts/smoke-stage8.mjs：2 项验收
  1) PTY 输出含 alt-screen 序列 → history_sync 含 'visible' 不含 'hidden'
  2) ip_changed 协议层（机器层 IP 变化无法 smoke 模拟，由单测覆盖）
- 全量 typecheck 干净
- 全量单测 268 backend + 15 shared 通过（本阶段新增 19 单测：
  ansi-filter 10 + ip-monitor 7 + session controller alt 2）
- 端口 / 临时目录释放

## 当前阻塞

无。

## 验证结果

- ✅ typecheck（shared/backend/frontend）干净
- ✅ 单测 268 backend + 15 shared 通过
- ✅ stage-08 smoke 2/2 通过
- ✅ ADR 007 已记录
