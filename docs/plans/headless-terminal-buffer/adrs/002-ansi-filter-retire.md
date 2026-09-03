# ADR-002: AnsiFilter 退役，仅保留 CSI 3J strip

## 状态

已采纳(2026-09-03)

## 上下文

`AnsiFilter`（backend/src/utils/ansi-filter.ts）做两件事：

1. **alt-screen 过滤**：正则探测 DECSET 1049 进入/退出，alt 期间内容不进 OutputBuffer
   / 不广播，防 TUI 临时画面污染重连回放（ADR-007 时代的决策）
2. **CSI 3J strip**：剥 `\x1b[3J`（Erase Saved Lines），防 claude/ink 每次重绘前清掉
   前端 xterm 的 scrollback（移动端用户翻不到历史）

默认配置下整个 filter 关闭（`resolveAnsiFilterEnabled` 默认 false，claude 还在强制关闭
名单里），仅 `OCR_ANSI_FILTER=true` 时启用——而启用 alt 过滤与 claude（全程 TUI）冲突
会被黑名单拒绝，实际只有 3J strip 那半个功能对非 TUI 命令生效。

headless 重构（ADR-001）后，PTY 原始流（strip 3J 后）write 进 headless Terminal。

## 决策

**AnsiFilter 整体退役**（类、`resolveAnsiFilterEnabled`、`OCR_ANSI_FILTER` /
`OCR_ANSI_FILTER_TUI_NAMES` 配置路径、`isFullAltScreenTui` 名单）。3J strip 以模块级
正则的形式并入 TerminalState 的写入路径，**无条件生效**。

## 拒绝的替代方案

### 方案 A：保留 AnsiFilter 作为 headless 前置

alt 过滤与 headless 直接冲突：alt 内容被过滤掉就不进 headless → serialize 恢复不出
alt 屏当前画面（vim/htop 用户重连后空白）。不可行。

### 方案 B：保留类与配置开关，仅默认关闭

死代码 + 双路径维护成本；3J strip 是无条件正确的（ink 的清屏行为对 scrollback 有害
无益），没有理由留开关。

## 理由

1. alt/normal buffer 的管理由 headless 的完整 VT 解析器接管——alt 内容只占 alt buffer
   一屏、不污染 scrollback，AnsiFilter 靠正则探测想达成的目标自动成立且更准
   （`scanAltScreenToggle` 同款探测对 ink 的 normal-screen 重绘本来就无效）
2. 3J 必须在 headless 写入前 strip（否则 headless 自己的 scrollback 被 ink 清掉，
   重连丢历史），因此 strip 点从"广播前"迁到"写入 + 广播前"，无条件化
3. 旧默认配置下 3J strip 本就未生效（filter 整体默认关）；新实现让它恒定生效，
   前端可翻阅内容变多，无回退风险

## 后果

- ✅ 删除约 350 行（filter 类 + 配置解析 + 名单）及配套测试，`SessionController`
  构造参数 `ansiFilter` 移除
- ✅ serialize 语义下 alt 屏画面可正确恢复（相对旧行为的增强）
- ⚠️ 行为变化：`OCR_ANSI_FILTER` 不再有任何效果——文档/README 若提及需同步清理
- ⚠️ 前端收到的流不再含 3J，scrollback 不再被 ink 擦（正向变化，见 design.md）
- `PtyManager.scanAltScreenToggle`（alt_screen_change 事件源）**不退役**：前端 touch
  滚动依赖该事件，与 headless 无耦合
