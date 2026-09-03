# ADR-001: 用终端状态模型（grid）替代输出流缓冲

## 状态

已采纳(2026-09-03)

## 上下文

`OutputBuffer` 按 `\n` 分行缓冲 PTY 原始输出，行数上限 maxBufferLines（默认 10000），
用于客户端重连时全量回放（history_sync）。

2026-09-03 长跑实例事故取证证实该模型存在两组致命缺陷：

1. **内存无界**：行数上限不是字节上限。claude code（ink）全屏 TUI 用光标定位重绘、
   几乎不发 `\n`，全部输出堆积在 `partial` 单条字符串上（实测 428 MB 且持续增长，
   6 天实例 RSS 1.34 GB → 当日 3 GB）。
2. **CPU O(n²)**：每次 `append` 执行 `partial + data` + `split('\n')`，
   partial 越大每次复制越贵；输出洪流期间 worker 满核（生命周期均值 33.7%）。

交互场景下回车会周期性注入 `\n` 落定 partial，掩盖了问题；挂机自主任务（本项目核心
场景）必然触发。

## 决策

**用 `@xterm/headless`（headless xterm.js Terminal）替代 OutputBuffer 作为重连回放
的数据源，`@xterm/addon-serialize` 负责把终端状态序列化为转义流。**

PTY 输出 write 进 headless Terminal（scrollback = maxBufferLines），由完整 VT 解析器
维护 normal buffer grid + alt buffer。重连时 `serialize()` 产出"当前画面 + scrollback"
的转义序列流，经 `history_sync.data` 下发——协议字段与消费方式（前端 `term.write`）
零变化。

## 拒绝的替代方案

### 方案 A：保留流式缓冲 + partial/总字节硬上限

止血有效（1-2 小时工作量），但上限值是拍脑袋的截断闸：截断点破坏 ANSI 流完整性、
回放仍是冗余帧流、巨行场景仍需持续丢内容。被否决：用户明确要求语义有界而非字节截断，
且止血代码会在本重构落地后即退役。

### 方案 B：alt/normal 探测分流（轻量语义）

alt-screen 期间只保留尾部。致命伤：claude（ink）用 normal screen + 增量重绘，
不走 alt-screen，主场景完全探测不到。对本项目无效。

### 方案 C：tmux 做后端

grid 模型的正确实现，但引入外部二进制依赖（Windows/WSL 复杂化）、双 TUI 嵌套的
鼠标/resize 边缘 bug、整套 PTY/WS 协议重构。远期可选，本次不做。

### 方案 D：gzip 压缩流 / 磁盘 spill

压缩只延迟不消除无界；spill 引入索引/清理/损坏恢复全套复杂度。均 overkill。

## 理由

1. **上限内建于模型**：内存由 scrollback 行数 × 列宽 × 定长 cell 封顶（万行量级 ≈
   十几 MB），不需要外加字节闸；超长行自动 wrap 成多行挤进 scrollback，"行长"这个
   无界维度消失。
2. **冗余自动去重**：TUI 重绘是覆盖写，旧帧在 grid 中自动消失——claude 数百 MB 的
   输出流在 grid 里只是"当前屏 + 语义化历史行"。这正是 tmux 长跑不膨胀的机理。
3. **生产验证**：VS Code 终端持久化（窗口重载后恢复终端内容）即 node-pty +
   headless xterm + serialize 架构，每天海量用户运行。
4. **协议零变化**：serialize 输出是标准转义序列流，前端 xterm 5.5 直接消费，
   前后端无版本耦合。
5. CPU：xterm 解析器 O(chunk) 增量解析，无拼接复制；serialize 仅在重连时执行。

## 后果

- ✅ 长跑实例内存/CPU 恒定有界，"开几天越来越卡"根除
- ✅ 重连回放从"病态时 GB 级乱流"变为"干净最终画面 + scrollback"，与 tmux attach
  心智一致
- ⚠️ backend 依赖体积 +约 2 MB（headless 1.9 MB + serialize 0.2 MB unpacked），npm 包
  变大
- ⚠️ serialize 对极端样式（OSC 8 超链接、bidi 等）有已知 lossy；终端模式（鼠标追踪等）
  不随序列化还原——重连后前端需重发 resize（现有链路已有，补回归测试）
- ⚠️ `write` 排队异步解析引入 history_sync 与实时增量的顺序问题，需 broadcast 排除
  机制（见 design.md §1）
- ⚠️ OutputBuffer 及其测试退役；`maxBufferLines` 语义映射为 scrollback 行数（不变）
