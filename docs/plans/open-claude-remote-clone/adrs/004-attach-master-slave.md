# ADR-004: 客户端类型 webapp / attach 主从仲裁

## 状态

已接受（阶段 7 实施）

## 背景

claude-remote 同时支持两种客户端连入 PTY：

- **webapp**：浏览器 Web 控制台（手机 / 平板 / 桌面浏览器）
- **attach**：另一台 PC 上的 `claude-remote attach <url>` 命令行客户端

两者都从同一 WebSocket 接收 PTY 输出（terminal_output / history_sync），都能
发送 user_input 和 resize。问题在于"PTY 应该按谁的尺寸渲染"——同一 PTY 不能
同时按 80x24 和 120x40 渲染。

如果不仲裁：

- 两端都发 resize 时，最后一个写入的尺寸生效（不可预测）
- 用户在手机上调整字号（webapp resize），attach 那边的 SIGWINCH 又把它覆盖
- 输出在某一端看起来"被截断"或"留大量空行"

## 决策

`SessionController.wireWs.onResize` 内做主从仲裁：

| 客户端组合 | resize 控制权 |
|---|---|
| 仅 PC 终端（无 WS 客户端） | TerminalRelay 监听 SIGWINCH |
| 有 webapp（无论是否还有 attach） | webapp（attach 的 resize 被忽略） |
| 仅 attach | attach |

切换边界：

- webapp 连入 → 立即接管，attach 后续 resize 被忽略
- webapp 全断、attach 仍在 → 服务端**主动广播一次** `terminal_resize` 让
  attach 重新校准本地终端（webapp 在线期间 attach 的本地终端尺寸可能已偏离）
- webapp 重新连入 → 再次接管

`onUserInput` 不参与仲裁——所有客户端的输入都透传到 PTY，因为输入是
"附加事件"，不会冲突；仅 resize 是"互斥状态"。

## 理由

1. **webapp 优先反映用户主要工作面**：手机 webapp 通常是用户当前操作的
   设备，按它的尺寸渲染 = 按用户实际看到的渲染
2. **attach 默认作为镜像**：attach 设计上是"远程旁观/接管"角色，让它跟随
   主控更符合心智
3. **避免 webapp 频繁刷新被 attach 反复覆盖**：手机端旋屏 / 字号变化频繁，
   attach 的 SIGWINCH 偶尔触发也很常见，让 webapp 优先减少抖动
4. **attach 校准广播能让旁观者无感切回**：webapp 全断后用户回到 PC 时，
   attach 一次广播即可让本地终端按实际 PTY 尺寸重排，不需要用户手动 resize
5. **实现位置单一**：仲裁只在 `wireWs.onResize` 一处，不分散；`onUserInput`
   保持透传简化逻辑

## 后果

- ✅ **正面**
  - webapp 与 attach 同时使用时尺寸稳定，无来回抖动
  - 用户主要操作面（手机）的体验不被 attach 拖累
  - 切换不需要任何协议字段，纯服务端策略
- ⚠ **负面**
  - attach 用户在 webapp 在线时无法主动改 PTY 尺寸——通过 stderr 提示
    `[remote resize WxH]` 让用户知晓"远端被改尺寸了"作为感知补偿
  - 仲裁规则隐式（前端不感知）：未来若需要复杂控制（多 attach 选主等）
    需要协议层加显式字段
- 🔵 **中性**
  - `getClientCounts` 在 onResize 内每次调用：开销极小（Map size + 一次循环）

## 备选方案

- **第一连接者主控**：先到先得；切换隐式（用户察觉不到谁在主控），
  webapp 中途连入反而会被忽略——与"主要工作面优先"心智相反
- **协议层加 `claim_resize` 显式信令**：客户端要明确请求/释放主控；
  实现复杂、UI 也要加按钮；当前两类客户端的角色已明确，不需要协商
- **取最小尺寸**：避免裁剪安全，但浪费屏幕；体验差
