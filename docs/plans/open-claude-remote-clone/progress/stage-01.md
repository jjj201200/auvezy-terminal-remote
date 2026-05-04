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
- [ ] **1.5** SessionController（PTY↔WS 桥接、批合并、history_sync）+ 单测
- [ ] **1.6** TerminalRelay（PC 终端 raw mode + 双 Ctrl+C + Kitty 协议）+ 单测
- [ ] **1.7** frontend useTerminal hook（xterm + addons + 批写入 + auto-follow）
- [ ] **1.8** frontend useWebSocket hook（重连退避 + connectionToken 防 race）
- [ ] **1.9** frontend ConsolePage 最简版（接 useTerminal + useWebSocket）
- [ ] **1.10** backend index.ts 启动序列（spawn PTY + 接 SessionController）
- [ ] **1.11** 端到端 smoke test（单端 + 多端重连 + 双 Ctrl+C）
- [ ] **1.12** 阶段 1 收尾（typecheck/test 全通 + overview 同步）

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

### 1.5 SessionController
（待开始）

### 1.6 TerminalRelay
（待开始）

### 1.7 useTerminal
（待开始）

### 1.8 useWebSocket
（待开始）

### 1.9 ConsolePage
（待开始）

### 1.10 index.ts 启动序列
（待开始）

### 1.11 端到端 smoke
（待开始）

### 1.12 阶段收尾
（待开始）

## 当前阻塞

无。

## 验证结果

（阶段完成后填写）
