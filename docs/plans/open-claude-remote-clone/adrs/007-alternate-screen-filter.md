# ADR-007: 启用 AlternateScreenFilter（与上游不同的决策）

## 状态

已接受（阶段 8 实施）

## 背景

终端应用（vim、htop、less、Claude Code 自身）启动时常会发 `\x1b[?1049h`
进入 **备用屏幕缓冲区（Alternate Screen Buffer）**，退出时发 `\x1b[?1049l`
还原原始屏幕。语义上备用屏幕的内容是"临时画面"——退出后用户期望看到的是
进入前的 history。

claude-remote 把 PTY 输出存进 OutputBuffer 用作**重连回放**。问题是：

- 用户在手机 webapp 上离线了几分钟
- 期间 Claude 进入备用屏幕（如 spawn 了 vim）后又退出
- 重连时 OutputBuffer 全量 history_sync，把 vim 临时画面也重放出来
- 用户看到一堆"消失了的画面"，混入真正的 history，体验破坏

上游 `open-claude-remote@0.1.1` 的处理是：**不过滤**——把 alt-screen 内容
也存进 buffer，理由是某些用户希望"重连后看到 vim 当前画面"。

## 决策

我们的实现 **默认开启** alt-screen 过滤：

- AnsiFilter 状态机识别 `\x1b[?1049h` 进入 / `\x1b[?1049l` 退出
- alt 模式期间的输出被 drop（不进 OutputBuffer，不广播给 webapp）
- 进入 / 退出序列本身保留（让 xterm.js 知道状态切换）
- **PC 终端（process.stdout）始终用原始数据**：PC 上看 vim 等应用是有意义的
- 通过 `SessionControllerOptions.ansiFilter: false` 可以关闭过滤恢复上游行为

## 理由

1. **webapp 是移动端为主，history 友好滚动是核心心智**：手机用户对
   "重连看到的就是进入前的 history"非常敏感
2. **重连场景频繁**：移动设备网络不稳，用户离线几分钟就连不上是常态。
   每次回来都被 vim 残影刷一屏体验差
3. **alt 应用的"当前画面"靠重连回放本身就不可靠**：vim 在远端进程内有
   状态，重连只 replay buffer 不会重新触发 vim 的"重绘"，看到的只是
   字节快照，不是真正的活画面
4. **PC 终端不受影响**：相同 PTY 的输出在 PC 终端上仍然原样显示，
   PC 用户看 vim 完全没问题
5. **可选关闭保留逃生口**：发现某用户场景必须保留 alt 内容（如 watch /
   htop 长期运行作 dashboard），通过 ansiFilter:false 即可恢复

## 后果

- ✅ **正面**
  - 重连体验显著提升：回到 history，不被 vim/htop 残影污染
  - OutputBuffer 容量利用更高效（不存被丢弃的临时画面）
  - PC 与 webapp 的"看到内容"差异是有意识的设计而非 bug
- ⚠ **负面**
  - 用户在 webapp 端无法实时看到 vim 当前画面（仅看到进入序列后的空屏）
  - AnsiFilter 状态机增加少量 CPU 开销（每段 PTY 输出额外字符串扫描）
  - 跨 chunk 拼接逻辑（pending）需要测试覆盖；当前 10 单测覆盖各边界
- 🔵 **中性**
  - 若用户报告需要 vim 在 webapp 实时可见，提供 ansiFilter:false 选项
  - 47 / 1047 / 1048（DECSET 旧变体）不识别——测试发现需要时再补

## 备选方案

- **保留上游"不过滤"行为**：history 干净不可保证，移动端体验差
- **运行时显式开关 + 默认关闭**：把决策推给用户；多数用户不会去翻配置，
  默认值决定大多数体验，所以默认 ON 更合适
- **过滤 alt 但保留最后一帧**：实现复杂；alt 应用的"画面"本身在重连时
  也已停滞，无意义
- **支持 47/1047/1048**：增加状态机复杂度；当前 1049 已覆盖 99% 终端
  应用的现代行为
