# Codex CLI hooks 机制与集成注入点调研（源码级）

> 调研日期：2026-10-14。版本基准：源码逐文件核对于 tag `rust-v0.162.1`（commit 092d3acd）。
> 来源：codex-rs 源码（hooks / config / protocol / rollout / app-server-protocol 等 crate）+ 官方文档 developers.openai.com/codex/hooks 与 config-reference。
> 用途：为 `backend/src/integrations/codex/` 集成模块（detect / spawn 注入 / hook 事件翻译）提供实现依据。

## 一句话总结

Codex 的 hooks 系统**刻意与 Claude Code hooks 兼容**（引擎类名就叫 `ClaudeHooksEngine`，仓库里有从 Claude settings.json 迁移 hooks 的模块）：事件名 / matcher / stdin payload / hookSpecificOutput / exit-code-2 语义几乎一比一对应；并额外提供 `PermissionRequest` 事件（审批弹框**前**同步触发、可感知**可决策**）——正是 atr pendingApprovals 需要的。

## 1. hooks 配置与加载

- 两种形态：`hooks.json`（放在 config layer 目录，格式 = Claude settings.json 的 hooks 段 + 可选 description）与 config.toml 内联 `[hooks]` 表。
- 可用位置（对 atr 有用的四个）：`$CODEX_HOME/hooks.json`（user 层）、`$CODEX_HOME/config.toml` 内联（user 层）、`<repo>/.codex/hooks.json`（project 层，仅 trusted 项目）、`<repo>/.codex/config.toml`。
- **合并语义（与 Claude 不同）**：所有层的所有匹配 hooks 全部加载执行（union 而非 overlay）。
- **feature 开关**：`features.hooks` 为 **Stable 且默认开启**，无需配置。
- config layer 栈（低→高）：PackagedDefaults → System → User → Project(.codex/) → MDM → SessionFlags。

## 2. 事件全集（12 个）

| 事件 | 触发点 |
|---|---|
| SessionStart | 会话启动/恢复/clear/compact/fork（matcher 匹配 source: startup\|resume\|clear\|compact\|fork） |
| SessionEnd | 会话结束（关闭/归档/删除/闲置 30 分钟） |
| UserPromptSubmit | 用户提交 prompt 后、送模型前 |
| PreToolUse | 工具调用前（matcher 匹配 tool_name：Bash、apply_patch(Edit/Write 别名)、mcp__x__y） |
| PostToolUse | 工具产出后（含非零退出；同上 matcher） |
| **PermissionRequest** | **审批 UI 弹出之前**（matcher 匹配 tool_name；不需要审批的命令不触发） |
| PreCompact / PostCompact | compact 前后（matcher 匹配 trigger: manual\|auto） |
| SubagentStart / SubagentStop | 子代理起止（matcher 匹配 agent_type） |
| Stop | 主回合 agent 停止（decision:block = 生成 continuation prompt 续跑） |
| Interrupt | 用户打断活跃回合 |

## 3. 执行契约

- command handler 是一条 **shell 字符串**，默认 `$SHELL -lc "<command>"` 执行（Unix 新 session / 独立进程组）。
- **payload 只通过 stdin**（完整 JSON 对象，无 argv / 无专用 env var）。cwd = 会话 cwd；hook 子进程环境 = codex 进程环境快照（因此 atr 注入的 env 如 ATR_HOOK_PORT 可见）。
- PreToolUse payload（各事件公共字段：session_id / transcript_path / cwd / hook_event_name / model）：
  ```json
  { "session_id": "...", "turn_id": "...", "cwd": "...", "hook_event_name": "PreToolUse",
    "model": "gpt-5.x", "permission_mode": "default|acceptEdits|plan|dontAsk|bypassPermissions",
    "tool_name": "Bash", "tool_input": { "command": "rm -rf build" }, "tool_use_id": "..." }
  ```
- **PermissionRequest 输出**（atr 弃权即可：不输出 decision → 正常审批流照常弹框）：
  ```json
  { "hookSpecificOutput": { "hookEventName": "PermissionRequest",
      "decision": { "behavior": "allow" } } }   // 或 {"behavior":"deny","message":"..."}
  ```
  多 hook 决策折叠：任一 deny 赢；否则最后一个 allow 赢；无决策 → 正常弹框。
- PreToolUse 可 deny / allow+updatedInput 重写；PostToolUse 的 block = 把结果替换为反馈让模型继续。
- **exit code**：0 成功；2 = 阻塞/反馈（reason 取 stderr）；其它非零 = 失败。**hook 失败一律 fail-open**（操作继续、审批照弹）——atr hook 崩了不会挂掉用户会话。
- **timeout**：每 handler 可配（默认 600s）；SessionEnd/Interrupt 默认 1s 上限 3s；**PermissionRequest 应设 3-5s**（超时 = 无决策 → 正常弹框，但会拖慢审批等待）。

## 4. trust 机制（注入的关键约束）

- 非托管 hooks（user/project/plugin）**默认 Untrusted，静默跳过**，TUI 启动警告提示 `/hooks` 审查。trust 记录 = hook 定义的 SHA-256（写进 user config.toml 的 `[hooks.state."<key>"]`，key = `<hooks文件绝对路径>:<event_snake>:<group_idx>:<handler_idx>`）——**算法版本敏感**（规范化结构随版本变）。
- **一次性绕过**：CLI 旗标 `--dangerously-bypass-hook-trust` 跳过信任检查直接执行。**atr 注入的最省事通道。**
- managed 来源天然 trusted 但需要系统级 requirements.toml，不适合 atr。

## 5. CODEX_HOME 镜像（可行，与 claude config-dir-mirror 同构）

- `CODEX_HOME` env 优先但**必须指向已存在目录**且会被 `canonicalize()` → **镜像目录必须是真实目录 + 内部逐项 symlink**；CODEX_HOME 本身绝不能是 symlink（否则解析回真实 ~/.codex，镜像失效）。
- 布局（惰性创建，无硬性首启结构）：`auth.json`（登录态，symlink 共享）、`sessions/YYYY/MM/DD/rollout-*.jsonl`（symlink sessions/ 目录）、`history.jsonl`（symlink 文件）、`config.toml` + `hooks.json`、`log/` / `themes/` / `plugins/`（可留空自建）。
- **[projects."<path>"] trust_level 存在 user config.toml**：若 atr 生成自己的 config.toml 而不同步用户原配置，用户的项目 trust / model / MCP 全丢。**推荐：config.toml symlink 保真，atr 注入走镜像目录的 hooks.json（独立文件，union 合并不冲突）**。
- 项目级 `.codex/` 层仅 trusted 项目生效（读用户 config.toml 的 projects trust；镜像方案下 symlink 保真即不受影响）。

## 6. detect 线索

- **无 `CLAUDE_CODE_ENTRYPOINT` 等价物**（全仓确认无 CODEX_ENTRYPOINT；codex 不给自身进程设特征 env）。
- 可靠方案（atr 是 spawner 天然占优）：spawn 注入 `CODEX_HOME=<镜像>` 本身就是强特征（environ 出现非空 CODEX_HOME ≈ atr 派生的 codex）；命令行 basename `codex` 兜底。
- codex 给它派生的 shell 注入 `CODEX_THREAD_ID`（子进程特征，不是 codex 自身的）。

## 7. 审批感知与旁路通道

- **首选：PermissionRequest hook**（见 §3）。审批解除无专门事件：放行后紧接 PreToolUse → PostToolUse，可据此清 pending；拒绝则该工具调用不再出现（超时 + 后续事件对账）。
- rollout `sessions/**/*.jsonl` 的 event_msg 类型：`exec_approval_request` / `apply_patch_approval_request` / `exec_approval`（决策落盘）/ `exec_command_begin/end` / `mcp_tool_call_begin/end` / `hook_started/completed` / `turn_aborted` 等——tail 镜像 sessions/ 可作无侵入旁路（二期可选）。
- app-server JSON-RPC 把审批作为 server→client 请求推送，但要求 codex 以 app-server/daemon 形态跑——PTY 场景不通，仅 atr 托管进程时可用。
- **TUI statusline 不是通道**：`[tui] status_line = [...]` 是内置 item 列表（model-with-reasoning / current-dir / thread-name…），全部内部渲染，无外部命令、无模板变量。唯一外部通知是 legacy `notify = ["program", ...]`（agent-turn-complete，argv 尾参传 kebab-case JSON，可作回合结束兜底信号）。

## 8. 对集成模块的直接推论

1. hook-mapper 可沿用 claude 集成心智模型：PreToolUse/PostToolUse/Stop/SessionStart/SessionEnd 一一对应，新增 PermissionRequest（审批感知）、Interrupt、Pre/PostCompact。
2. 注入点：镜像 CODEX_HOME（真实目录 + symlink auth.json/sessions/history.jsonl/config.toml）+ 生成 hooks.json + spawn 加 `--dangerously-bypass-hook-trust`。
3. pendingApprovals：同步 PermissionRequest hook（timeout 3-5s、不返回 decision），回调 atr 的 loopback hook HTTP（复用 claude 集成同款 ATR_HOOK_PORT 模式；hook 子进程继承 codex 环境 → env 可见）。
4. detect：命令名 codex + spawn 注入的 CODEX_HOME 特征 env。
5. statusline 无对应物，跳过；工具/回合摘要用 PostToolUse / Stop hooks（legacy notify 兜底）。

## 9. 实测校准记录（2026-10-14，本机 codex-cli 0.162.1）

隔离 CODEX_HOME + SessionStart hook（副作用文件）双向验证 atr 复现的哈希算法：

- hooks.json handler `{ type: "command", command: "echo fired >> /tmp/codex-trust-fired", timeout: 3 }`，matcher `""`
- atr 算法（`{event_name:"session_start", matcher:"", hooks:[{async:false,command,timeout:3,type:"command"}]}` → 递归键排序紧凑 JSON → sha256）产出 `sha256:ca05b741…`，写入 `[hooks.state."/tmp/…/hooks.json:session_start:0:0"]` 后：**`hook: SessionStart Completed` + 副作用文件出现**（trusted ✓）
- 同配置哈希改错一位重跑：**hook 静默跳过、无副作用文件**（untrusted 判定真实生效 ✓）

golden 值已固化进 `backend/src/integrations/codex/codex.test.ts`（computeHookTrustHashFor golden 用例），重构 canonicalJson 时该用例是算法回归锚点。
