# headless-terminal-buffer：终端状态模型重构

## 背景（事故实证）

用户长跑实例（`atr claude` 挂机 6 天）出现渐进卡顿 → 满核 → 内存暴涨。现场取证结论：

- worker RSS 随运行时长单调增长：112 MB（35 min）→ 139 MB（2 d）→ 1.34 GB（6 d）→ 3 GB（取样当日）
- V8 堆内一条 **428 MB（取样时刻）的单体字符串**，内容是 claude code 的 ANSI 重绘流
- 根因：`OutputBuffer` 按 `\n` 分行，而 claude（ink/TUI）输出几乎不含 `\n`——全部堆积在
  `partial` 上无限增长；且每次 `append` 执行 `partial + data` + `split('\n')`，
  partial 越大每次复制越贵（O(n²)），输出洪流期满核

本质：**流式字节缓冲（log 模型）对屏幕式程序（TUI）的冗余重绘流不适用**。
tmux 不炸的原因是它存终端状态（grid），不存输出流。

## 目标

1. 内存/CPU 语义有界：上限来自数据模型自身维度（scrollback 行数 × 列宽），**不引入任何字节硬上限**
2. 协议零变化：`terminal_output` / `history_sync` / `status_update` 等消息字段与语义不变（上游契约）
3. 重连回放体验对齐 tmux/VS Code：恢复"当前画面 + 语义化 scrollback"，而非回放原始字节流

## 架构

```
PTY data ──┬──→ process.stdout（PC 终端，不变）
           │
           ├──→ strip CSI 3J ──→ 实时广播 terminal_output（不变，strip 后流）
           │
           └──→ strip CSI 3J ──→ TerminalState.write()
                                   （@xterm/headless Terminal，scrollback=maxBufferLines）
                                   （完整 VT 解析 → normal buffer grid + alt buffer）

重连：TerminalState.serialize()（@xterm/addon-serialize）
       → history_sync.data（一条转义序列流，前端 term.write 照旧消费）
```

- **依赖**：`@xterm/headless@5.5.0`（与前端 `@xterm/xterm@^5.5.0` 同线）+
  `@xterm/addon-serialize@0.14.0`。VS Code 终端持久化（窗口重载恢复）的生产同款架构。
- **seq**：TerminalState 维护 write 计数（单调递增版本戳），语义与旧 `OutputBuffer.sequenceNumber` 一致。

## 关键设计点

### 1. history_sync 与实时增量的顺序保证

xterm headless 的 `write` 是排队异步解析的，`serialize()` 必须 `await` 解析队列 flush。
这引入竞态：新客户端可能先收到增量 `terminal_output`、后收到全量 `history_sync`
（前端 reset 会吞掉这段时间的增量）。

方案：**history_sync 未完成的客户端从 broadcast 中排除**。

- `WsServer.broadcast(msg, exclude?: Set<WebSocket>)` 增加可选排除参数（向后兼容）
- SessionController：onConnect 时把连接加入 `pendingHistory` 集合并异步 serialize；
  完成后先比对 seq 未变（await 恢复点是同步延续，比对+发送原子），再
  `pendingHistory.delete(ws)` + `sendTo`
- 客户端收到顺序严格为：全量（到 seq N）→ 增量（seq > N）

### 2. CSI 3J strip（ink 防 scrollback 擦除）

claude/ink 持续发 `\x1b[3J`（Erase Saved Lines）清 scrollback。headless 同样会吃这个
序列——scrollback 被清 = 重连回放丢历史。**必须在写入 headless 前 strip**。

- 实现：模块级正则 `/\x1b\[3J/g`，write 与广播共用同一份 strip 后的数据
- 跨 chunk 切断的 4 字节序列概率极低（与旧 AnsiFilter 同款论证），接受
- **行为变化**：旧默认配置（ansiFilter=null）下前端收到原始 3J、scrollback 被 ink 反复擦；
  新实现统一 strip，前端可翻阅内容变多（符合旧 AnsiFilter `stripEraseScrollback` 的
  既有设计意图，该意图此前因 filter 整体默认关闭而未生效）

### 3. AnsiFilter 退役

headless 的 normal/alt buffer 由真正的 VT 解析器管理：
- alt-screen 内容只占 alt buffer（一屏），不污染 scrollback——`AnsiFilter` 靠正则探测
  想做的事（防 TUI 帧污染回放）在 grid 模型下自动成立且更准
- claude（ink）实际用 normal screen + 光标增量重绘，旧 alt 探测对它本来就无效；
  grid 模型下被覆盖的旧帧自动消失

`AnsiFilter` / `OCR_ANSI_FILTER` 开关随之退役（resolveAnsiFilterEnabled 及相关配置路径删除）。

### 4. resize 同步

`pty.on('resize')` 处同步 `state.resize(cols, rows)`。grid 的 wrap 重排（reflow）是
xterm 内建行为，与 tmux 一致。

### 5. 保留不变的部分

- `PtyManager.scanAltScreenToggle`（alt_screen_change 事件的探测）：前端 touch 滚动
  行为依赖它，与 headless 无耦合，不动
- `writeToProcessStdout`（PC 终端原始输出）、WS 批合并三阈值（16ms/32KB/256KB）、
  `pendingApprovals` 状态机等全部不动

## 行为变化汇总（用户可感知）

| 场景 | 旧 | 新 |
|---|---|---|
| claude 挂机数天 | 渐进卡顿 → 满核 → OOM | 恒定（基线 + 十几 MB） |
| 重连回放 | 原始字节流（含全部冗余帧，病态时 GB 级） | 干净的最终画面 + scrollback（十几 MB 上界） |
| 前端可翻阅 scrollback | 被 ink 的 3J 反复擦 | 不再被擦，可翻内容更多 |
| OCR_ANSI_FILTER 配置 | 生效 | 退役（语义由 grid 模型自动覆盖） |

## 里程碑

1. 计划文档 + ADR（本文件）
2. 依赖引入
3. `TerminalState` 组件（backend/src/pty/terminal-state.ts）
4. SessionController / WsServer 接线
5. 测试（单测 + serialize 回放保真度）
6. build + dev 实例 smoke（连真实 claude：回放 / 重连 / 翻阅 / alt-screen / resize）
