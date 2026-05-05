# 阶段 1 进度：PTY ↔ WS ↔ xterm 闭环

## 目标

跑起最简单的"PC 终端 + 浏览器看 Claude 输出 + 输入命令"。**没有认证、没有多实例、没有审批**——只验证数据通路。

## 验收标准

- 启动后 PC 终端进入 raw mode，能像直接跑 `claude` 一样使用
- 浏览器打开 `http://localhost:3000/`，能看到 Claude 的实时输出
- 浏览器输入栏发送字符 → PTY 收到 → 输出回显到所有客户端
- 双客户端（两个浏览器 Tab）输出一致，重连后通过 history_sync 全量恢复
- 双 Ctrl+C（500ms 内）退出代理，单 Ctrl+C 透传给 Claude

## 步骤清单

- [x] **1.1** PtyManager（node-pty 包装、resize 去重、4 事件）+ 单测
- [x] **1.2** OutputBuffer（按行环形缓冲、partial line、seq）+ 单测
- [x] **1.3** WsServer（noServer upgrade、心跳、3 个 hook）+ 单测
- [x] **1.4** ws-handler（消息分发器）+ 单测
- [x] **1.5** SessionController（PTY↔WS 桥接、批合并、history_sync）+ 单测
- [x] **1.6** TerminalRelay（PC 终端 raw mode + 双 Ctrl+C + Kitty 协议）+ 单测
- [x] **1.7** frontend useTerminal hook（xterm + addons + 批写入 + auto-follow）
- [x] **1.8** frontend useWebSocket hook（重连退避 + connectionToken 防 race）
- [x] **1.9** frontend ConsolePage 最简版（接 useTerminal + useWebSocket）
- [x] **1.10** backend index.ts 启动序列（spawn PTY + 接 SessionController）
- [x] **1.11** 端到端 smoke test（用 bash 替代 claude，验证完整数据流）
- [x] **1.12** 阶段 1 收尾（typecheck/test 全通 + overview 同步）

## 实施日志

### 1.1 PtyManager · 完成 2026-05-05

**产出**：
- `backend/src/pty/types.ts`（IPtyManager 接口，让 SessionController 多态对待本地/远程 PTY）
- `backend/src/pty/pty-manager.ts`（EventEmitter + 4 事件 + spawn/write/resize/destroy）
- `backend/src/pty/pty-manager.test.ts`（10 个测试用 cat 命令验证真实 PTY 行为）

**关键设计**：
- resize 同尺寸跳过——这是避免 webapp→PTY→broadcast→webapp 回环的关键单点
- spawn 失败用 `queueMicrotask(() => emit 'error')` 异步派发，让监听器有机会先注册
- exited 后 write/resize 静默丢弃不抛错，避免客户端在 exit 通知到达前发消息让代理崩溃
- 用 PtyError(ErrorCode.INSTANCE_ALREADY_RUNNING) 拒绝重复 spawn

**踩坑**：node-pty spawn 不存在的命令时不抛异常、不 emit error，而是子进程非 0 退出——测试用例改为验证 exit code 非 0。

**测试**：10/10 通过

### 1.2 OutputBuffer · 完成 2026-05-05

**产出**：
- `backend/src/pty/output-buffer.ts`（按行环形缓冲 + partial line + 单调 seq + trim 摊销）
- `backend/src/pty/output-buffer.test.ts`（18 测试）

**关键设计**：
- 按行而非字节存储，`maxLines` 语义直观
- 不完整行存 partial，下次 append 拼接——保证流式数据被正确切分
- seq 每次 append +1 不论内容（空字符串也算），契合"版本戳"语义
- 超过 maxLines × 1.1 才裁剪——把 splice 成本均摊
- `getFullContent()` 重建带 \n 的原始流，让 history_sync 接收方与实时画面一致

**踩坑**：测试用 `not.toContain('line1')` 时会被 `line11`/`line10` 子串命中导致误判——改用精确等值断言。

**测试**：18/18 通过，backend 累计 47/47。

### 1.3 WsServer · 完成 2026-05-05

**产出**：
- `backend/src/ws/ws-server.ts`（noServer 模式 + 心跳 + 三 hook + WeakMap 客户端类型映射）
- `backend/src/ws/ws-server.test.ts`（9 测试，起真实 HTTP server + WS 客户端）

**关键设计**：
- noServer 模式手挂 `httpServer.on('upgrade')`，仅 pathname `/ws` 通过，其它直接 destroy
- 客户端类型用 `WeakMap<IncomingMessage, ClientType>` 在 upgrade 阶段记录，connection 阶段读取——WeakMap 自动 GC 不留泄露
- `WsServerOptions.authenticate` 是一个回调，让阶段 2 注入 AuthModule 时不需要改 ws-server 主体
- 心跳定时器用 `unref()` 避免阻塞 `process.exit`
- broadcast 序列化一次循环发送

**测试**：9/9 通过（路径鉴权、authenticate hook、onConnect/onMessage/onDisconnect、broadcast、counts、destroy）

### 1.4 ws-handler · 完成 2026-05-05

**产出**：
- `backend/src/ws/ws-handler.ts`（switch on type 派发到回调，heartbeat 在本层回包不进业务）
- `backend/src/ws/ws-handler.test.ts`（10 测试 mock WebSocket）

**关键设计**：
- 非法 JSON / 缺字段 / 类型错误一律静默忽略 + warn 日志，不抛异常（防恶意客户端崩代理）
- heartbeat 在本层直接 ws.send 回包，不污染 SessionController
- callbacks 拆细到 `onUserInput / onResize`——业务层不需要看到协议形状

**测试**：10/10 通过

### 1.5 SessionController · 完成 2026-05-05

**产出**：
- `backend/src/session/session-controller.ts`（依赖注入 PtyManager + WsServer + maxBufferLines；批合并 16/32K/256K；4 PTY 事件 wiring；onConnect 推 history_sync）
- `backend/src/session/session-controller.test.ts`（16 测试，MockPty + MockWs 不依赖真实 ws/pty）

**关键设计**：
- 三阈值批合并（16ms / 32KB / 256KB）——与上游策略一致
- 客户端连入立即 sendTo history_sync（含 seq + status + cols + rows）让重连画面与实时一致
- PTY exit 先 flush 再广播 session_ended——保证最后一行能到客户端
- 阶段 1 不做主从仲裁（attach 在阶段 7 加）；resize 直接透传到 PTY
- writeToProcessStdout 选项让单测不污染输出
- destroy 时 flush 一次，避免最后一段输出丢失

**测试**：16/16 通过（status 切换、批合并三阈值、history_sync、PTY 4 事件、user_input/resize 透传、非法消息容错、seq 单调）。backend 累计 82/82。

### 1.6 TerminalRelay · 完成 2026-05-05

**产出**：
- `backend/src/terminal/terminal-relay.ts`（raw mode + 双 Ctrl+C + Kitty CSI u + pause/resume resize）
- `backend/src/terminal/terminal-relay.test.ts`（14 测试，提取关键算法做纯函数验证）

**关键设计**：
- 双 Ctrl+C 检测在 500ms 窗口内：第二次触发 `onExitRequest` 回调；单次透传给 PTY
- Kitty CSI u 协议匹配：仅 press/repeat（事件类型 1/2 或省略），不匹配 release（3）
- start/stop 在非 TTY 环境下安全：跳过 setRawMode 但仍监听 stdin data
- pause/resume resize 与 SessionController 主从仲裁配合（阶段 7 启用）
- 启动时主动同步一次尺寸——避免 PTY 默认 80×24 与 PC 终端不一致

**测试**：14/14 通过（Kitty 协议 7 边界、双击窗口 4、集成 3）。backend 累计 96/96。

### 1.7 useTerminal · 完成 2026-05-05

**产出**：
- `frontend/src/config/constants.ts`（前端运行时常量集中：批写入/重连/节流/scrollback/字号）
- `frontend/src/hooks/useTerminal.ts`（xterm 生命周期 + 三 addons graceful 降级 + 批写入 + auto-follow + resize 节流）
- `frontend/src/components/terminal/TerminalView.tsx`（forwardRef 极薄壳）
- `frontend/src/components/terminal/ScrollToBottomButton.tsx`

**关键设计**：
- 三 addon graceful 降级：FitAddon 必加；Unicode11Addon try/catch；WebglAddon try/catch + onContextLoss 自动 dispose
- 批写入 RAF + setTimeout 双保险——隐藏 tab 时 RAF 不触发，setTimeout 兜底
- resize 节流 + 去重：lastReportedResizeRef 去重，节流窗口内合并到 pending
- onResize 回调返回 false 时不更新 lastReportedResize——离线时下次能重发
- scrollSkipRef 计数器：每次程序滚动前 +1，吞下一次 onScroll，避免误识别用户滚动
- 所有可变状态用 useRef，仅 showScrollHint 用 useState 驱动按钮显隐
- cleanup 必须 cancel 所有定时器与 RAF，否则 unmount 后回调会抖

**typecheck**：通过

### 1.8 useWebSocket · 完成 2026-05-05

**产出**：
- `frontend/src/stores/app-store.ts`（zustand：connectionStatus + setter）
- `frontend/src/hooks/useWebSocket.ts`（重连退避 + connectionToken 防 race + offline 监听）

**关键设计**：
- `connectionTokenRef`：每次 connect 自增，所有 4 个 ws 事件回调入口都校验 `myToken !== connectionTokenRef.current` 静默丢弃过时连接
- `isDisposedRef`：dispose 后所有回调静默
- `onMessageRef` 镜像 prop：避免父组件回调引用变化让连接被重建
- 三重身份校验（dispose / token / wsRef===ws）：覆盖"卸载、新建、回调闭包过时"三种竞态
- offline 事件主动 close：wifi 切蜂窝时秒切而不是被动等 timeout
- send 严格 OPEN 检查，非 OPEN 返回 false 让上层重发（与 useTerminal 的 lastReportedResize 不更新策略闭环）
- 阶段 1 不做认证；阶段 2 加 cachedToken 重认证

**typecheck**：通过

### 1.9 ConsolePage · 完成 2026-05-05

**产出**：
- `frontend/src/components/input/InputBar.tsx`（受控 input，回车追加 \r 发送 user_input）
- `frontend/src/components/status/StatusBar.tsx`（连接状态 + 会话状态双 pill）
- `frontend/src/pages/ConsolePage.tsx`（消息分发 + useTerminal + useWebSocket + 子组件组合）
- `frontend/src/App.tsx`（更新为挂 ConsolePage，移除阶段 0 占位）
- `frontend/src/styles/global.css`（更新：ConsolePage 全屏布局 + 状态条/输入栏/滚动按钮样式）

**关键设计**：
- ConsolePage 用 `sendRef` 把 useWebSocket.send 暴露给 useTerminal 的 onResize——
  避免"useTerminal 在 useWebSocket 之前构造导致 send 未就绪"的初始化顺序问题
- 错误与 session_ended 用 ANSI 颜色直接写到 xterm 显示告警行（红色错误、黄色结束）
- InputBar 回车自动 append \r 模拟终端回车
- 离线时 InputBar disabled 防止用户白发

**typecheck**：通过

### 1.10 index.ts 启动序列 · 完成 2026-05-05

**产出**：
- `backend/src/index.ts`（22 阶段中的本阶段实现部分：环境变量配置 + 路由 + 静态 + PTY + WS + Session + Relay + spawn + shutdown + listen + banner）

**关键设计**：
- 环境变量驱动：`PORT / HOST / OCR_COMMAND / OCR_ARGS / OCR_CWD / NO_TERMINAL / INSTANCE_NAME / MAX_BUFFER_LINES`（旧名 `CLAUDE_*` 仍兼容，会 warn）
- TerminalRelay 条件创建：`!noTerminal && process.stdin.isTTY` 才启用
- onExitRequest（双 Ctrl+C）回调直接调 `shutdown(0)`
- PTY exit 后延迟 SHUTDOWN_WS_FLUSH_DELAY_MS（500ms）再 shutdown，让 WS 把最后一条消息发出去
- 强制退出兜底 SHUTDOWN_FORCE_EXIT_MS（2s）
- spawn 完成后 setStatus('running') 让客户端看到状态切换

**typecheck/build**：全过。下一步 1.11 端到端 smoke。

### 1.11 端到端 smoke · 完成 2026-05-05

**产出**：
- `backend/scripts/smoke-stage1.mjs`（自动化 WS 客户端验证脚本）

**验证项**（用 bash 作为 PTY 命令，因测试环境无 claude）：
- ✓ history_sync 收到（cols=80 rows=24 status=running seq=1）
- ✓ status_update 通过 history_sync 携带（重连恢复设计）
- ✓ terminal_output 批合并后下发（含 PTY 输出 178B）
- ✓ user_input 透传：发送 `echo OCRTEST123\r` 后 PTY 回显内容包含 OCRTEST123
- ✓ resize 触发 PTY resize 并回包 terminal_resize
- ✓ 测试结束 server kill + 端口释放 + logs 清理（CLAUDE.md 第一条）

**关键发现**：
- 客户端连入时 SessionController 推送 history_sync 已携带 status，因此独立的 status_update 在首次连接时不会再额外发——这是协议设计的"重连恢复"特性
- bash spawn 后的 PTY 输出格式：178B 含 ANSI 控制序列（提示符 + 命令回显 + 输出），证明数据通路完整

### 1.12 阶段收尾 · 完成 2026-05-05

**typecheck**：全 workspace 通过（shared / backend / frontend 三包都过 strict + noUncheckedIndexedAccess）

**测试**：
- shared：8/8
- backend：96/96（errors 19 + pty-manager 10 + output-buffer 18 + ws-handler 10 + ws-server 9 + session-controller 16 + terminal-relay 14）
- frontend：passWithNoTests
- 总计：104/104 通过

## 验证结果

✅ pnpm typecheck 全通
✅ pnpm test 全通（104/104）
✅ pnpm build 全链路通过（shared → frontend → backend → copy-frontend-dist）
✅ 端到端 smoke：history_sync / terminal_output / user_input / resize 数据流完整
✅ 测试结束所有进程与端口已释放（CLAUDE.md 第一条规则）

## 阶段完成对照（与原项目自检）

- [x] PtyManager：node-pty 包装、4 事件、resize 去重 ← 与上游设计一致
- [x] OutputBuffer：按行环形缓冲、partial line、单调 seq、trim 摊销 ← 与上游设计一致
- [x] WsServer：noServer + WeakMap clientType + 心跳 unref + 三 hook ← 与上游设计一致
- [x] ws-handler：消息分发 + heartbeat 直接回包 ← 与上游设计一致
- [x] SessionController：三阈值批合并 16/32K/256K + history_sync + 4 PTY 事件桥接 ← 与上游设计一致
- [x] TerminalRelay：raw mode + 双 Ctrl+C + Kitty CSI u + pause/resume ← 与上游设计一致
- [x] useTerminal：xterm + 三 addons graceful 降级 + 批写入 RAF/setTimeout 双保险 + auto-follow + scrollSkip 计数 ← 与上游设计一致
- [x] useWebSocket：重连退避 + connectionToken 防 race + offline 监听 ← 与上游设计一致

## 仍未实现（后续阶段补）

- 认证（阶段 2）
- 配置文件（阶段 4）
- Hook 接收 / 审批（阶段 3）
- 共享 Token / 二维码（阶段 5）
- 多实例 / Web 创建（阶段 6a / 6b）
- attach（阶段 7）
- IP 监控 / ANSI filter（阶段 8）
- Web Push（阶段 9）

## 当前阻塞

无。

## 验证结果

（阶段完成后填写）
