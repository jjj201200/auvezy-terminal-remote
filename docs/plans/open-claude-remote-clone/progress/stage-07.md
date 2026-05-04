# 阶段 7 进度：attach 子命令

## 目标

让用户在另一台 PC 用 `claude-remote attach <url>` 接管远程实例：终端实时同步、键盘输入透传、resize 跟随。

## 验收标准

- [x] attach 子命令解析 URL（http(s)://host:port[?token=...]）
- [x] 启动 raw mode stdin → WS user_input；WS terminal_output → stdout
- [x] WS 重连退避序列与前端一致
- [x] 主从仲裁：webapp 在线时 attach 仅显示输出 + 输入透传，但 resize 不接受；
      attach 单独时由 attach 控制 resize；webapp 上线后再切回 webapp 主控

## 步骤清单

- [x] **7.1** backend/attach/attach-client.ts（核心 client 类，可单测）+ 9 单测
- [x] **7.2** backend/attach.ts（CLI 子命令实现）
- [x] **7.3** cli.ts 接 attach 分发 + URL 透传
- [x] **7.4** SessionController 主从仲裁（webapp 优先）+ 3 仲裁单测
- [x] **7.5** 端到端 smoke 6/6 通过
- [x] **7.6** ADR 004 + 阶段收尾

## 实施日志

### 7.1 attach-client
- 设计要点：与 backend "VirtualPty"区分——attach 是独立 CLI 客户端，
  直接连入服务端 WS，不需要在 backend 内挂一个 IPtyManager 实现
- normalizeAttachUrl：http(s) → ws(s) + path 强制 /ws
- 事件：output / resize / status / connectionStatus / sessionEnded / fatal
- 重连：1008 → fatal 不重连；其它 close 走 ATTACH_RECONNECT_DELAYS_MS
- 9 单测：URL 改写边界 / history_sync 三事件 / write/resize 发到 server /
  1008 fatal / autoReconnect=false 不重连

### 7.2 attach.ts CLI
- stdin raw mode → AttachClient.write
- SIGWINCH → AttachClient.resize（启动后立即报一次本地终端尺寸）
- 双 Ctrl+C（500ms 内）退出 attach；单击仍透传
- WS terminal_output → process.stdout.write（PC 终端自己解 ANSI）
- status_update / sessionEnded / fatal → stderr 友好提示

### 7.3 cli.ts 分发
- subcommand=attach 时 import attach.js 并调 runAttachCli(url)
- attachUrl 由 cli-utils 在阶段 4 已经解析好

### 7.4 主从仲裁
- SessionController.wireWs.onResize：
  - webapp 在线 + 来源是 attach → 忽略
  - 仅 attach 在线 → attach 的 resize 生效
- onDisconnect：webapp 全断 attach 在 → 广播 terminal_resize 校准
- onUserInput 不参与仲裁，所有客户端透传
- 测试：MockWs 加 getClientCounts；新增 3 个仲裁专用单测；
  原 resize 测试明确"webapp 在线"场景

### 7.5 端到端 smoke
- backend/scripts/smoke-stage7.mjs：6 项验收
  1) attach WS 用 ?token 连入成功 + history_sync
  2) webapp WS（cookie）成功连入
  3) webapp 在线时 attach resize 被忽略（webapp 没收到 terminal_resize）
  4) webapp resize 90x28 → attach 收到 terminal_resize 90x28
  5) webapp 断开 → attach 收到一次 terminal_resize 校准
  6) 仅 attach 在线时 attach resize 110x35 生效

### 7.6 阶段收尾
- ADR 004 客户端主从仲裁记录
- 全量 typecheck 干净
- 全量单测 247 backend + 15 shared 通过（本阶段新增 12 单测：
  attach-client 9 + 仲裁 3）
- 端口 / 临时目录释放

## 当前阻塞

无。

## 验证结果

- ✅ typecheck（shared/backend/frontend）干净
- ✅ 单测 247 backend + 15 shared 通过
- ✅ stage-07 smoke 6/6 通过
- ✅ ADR 004 已记录
- ✅ 端口 / 临时目录释放
