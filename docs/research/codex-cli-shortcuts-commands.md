# OpenAI Codex CLI 调研（Rust TUI 版）

> 调研日期：2026-10-14。版本基准：rust-v0.162.1（2026-10-09 发布），键位核对自源码 `codex-rs/tui/src/keymap.rs` main 分支。
> 来源：[developers.openai.com/codex/cli](https://developers.openai.com/codex/cli)、[developer-commands](https://developers.openai.com/codex/developer-commands?surface=cli)、[build-skills](https://developers.openai.com/codex/build-skills)、[extend/mcp](https://developers.openai.com/codex/extend/mcp?surface=cli)、[config-reference](https://developers.openai.com/codex/config-file/config-reference)、GitHub openai/codex。
> 用途：为 `codex` 快捷键/命令组提供数据 + skill/MCP 自动发现的实现依据。

## 一、TUI 键盘快捷键

所有键位可经 config.toml `tui.keymap.<context>.<action>` 重绑（`/keymap` 交互式改）。context：`global` / `chat` / `composer` / `editor` / `vim_normal` / `vim_operator` / `vim_text_object` / `pager` / `list` / `agents` / `approval`。

### 主界面（global）

| 快捷键 | 作用 |
|---|---|
| `Ctrl+T` | transcript 全屏视图（开/关）——**不是 TODO 列表** |
| `F3` | transcript 中查找 |
| `F4` | 活动面板（focus_activity） |
| `F2` | 打开 warnings |
| `Ctrl+G` | 在 `$VISUAL`/`$EDITOR` 打开外部编辑器 |
| `Ctrl+O` | 复制最近一条完成的输出（同 `/copy`） |
| `Ctrl+L` | 清空终端视图（**保留当前 chat**，与 `/clear` 新 chat 不同） |
| `Alt+R` | 切换 raw scrollback 模式（同 `/raw`） |
| `Ctrl+/`（别名 Ctrl+7） | 切换 side conversation |

### 会话运行中（chat）

| 快捷键 | 作用 |
|---|---|
| `Esc` | 中断当前 turn |
| `Esc Esc`（空输入框） | 编辑上一条用户消息并从该点 fork（backtrack） |
| `Alt+,` / `Shift+Down` | 降低 reasoning effort |
| `Alt+.` / `Shift+Up` | 提高 reasoning effort |
| `Shift+Left` / `Alt+Up` | 编辑已排队的消息 |
| `Shift+Right` / `Alt+Down` | prompt_stack_back |
| `Ctrl+]` | 跳过当前问题 |
| `F8` / `F9` | 语音模式开/静音（实验性 /voice） |

### 输入框（composer）

| 快捷键 | 作用 |
|---|---|
| `Enter` | 提交；运行中 = 向当前 turn 注入新指令 |
| `Tab` | **把下一条 prompt/slash/shell 命令排入队列**（不是切 approval mode） |
| `?` | 快捷键帮助浮层 |
| `Ctrl+R` / `Ctrl+S` | 向上 / 向下搜索 prompt 历史 |
| `Up` / `Down` | 恢复输入草稿历史 |
| `@` | 文件搜索引用 |
| `$` | 显式调用 skill（`$skill-name`） |
| `!` 前缀 | 直接执行本地 shell 命令 |

### 行编辑（editor，emacs 风格）

`Ctrl+J/M`、`Shift/Alt+Enter` 换行；`Ctrl+A/E`、`Home/End`；`Alt+B/F`、`Ctrl+Left/Right` 按词移动；`Ctrl+W`、`Alt+Backspace` 删前词；`Ctrl+U/K/Y` 删到行首/尾、yank 等。

### Transcript / Pager

`Up/k`、`Down/j` 逐行；`PgUp/Shift+Space/Ctrl+B`、`PgDn/Space/Ctrl+F` 翻页；`Ctrl+U/D` 半页；`Home/End` 跳顶底；`q`/`Ctrl+C` 关闭；`Ctrl+T` 关 transcript；`F3` 或 `/` 查找。

### Agents 视图（线程选择器）

`o` resume、`n` 新任务、`/`/`F3` 搜索、`w` 新 worktree、`f` fork、`r` 重命名、`x` 停止、`a` 归档、`Backspace` 删除、`h` 隐藏、`p` 置顶、`g` 切换分组。

### 审批对话框

`Ctrl+A` 全屏查看命令、`o` 打开相关线程、`y` 批准一次、`a` 本会话始终批准、`p` 按前缀批准、`d` 拒绝、`Esc`/`n` 拒绝、`c` 取消。

### 硬编码（不可配置）

`Esc Esc`、`Ctrl+C`（**退出会话**；Ctrl+D 不是退出，只是删字符/半页滚动）、`Ctrl+Z` 挂起。

## 二、斜杠命令全集（CLI TUI）

| 命令 | 用途 |
|---|---|
| `/permissions` | 设置免批准范围 |
| `/ide` | IDE 打开文件/选区作上下文 |
| `/keymap` | 查看/重绑快捷键 |
| `/vim` | 切换 composer Vim 模式 |
| `/setup-default-sandbox` | Windows 提升沙箱安装 |
| `/sandbox-add-read-dir` | Windows 沙箱追加只读目录 |
| `/agent`（/subagents） | 切换/查看 subagent 线程 |
| `/apps` | 浏览 apps，插入 `$app-slug` |
| `/plugins` | 浏览/管理插件 |
| `/hooks` | 查看管理 lifecycle hooks |
| `/clear` | 清屏并开新 chat（可带名字） |
| `/rename` | 重命名当前 chat |
| `/archive` | 归档当前会话并退出 |
| `/delete` | 永久删除当前会话并退出 |
| `/compact` | 压缩/总结上下文 |
| `/copy` | 复制最近完成输出（=Ctrl+O） |
| `/diff` | 显示 Git diff（含未跟踪） |
| `/exit`（/quit） | 退出 |
| `/experimental` | 切换实验特性 |
| `/approve` | 批准 auto-review 拒绝的重试 |
| `/memories` | 配置记忆 |
| `/skills` | 浏览并选用 skill |
| `/import` | 从 Claude Code/Cursor 迁移 |
| `/feedback` | 提交反馈 |
| `/init` | 生成 AGENTS.md 脚手架 |
| `/logout` | 登出 |
| `/mcp` | 列出 MCP server/tools；`/mcp verbose` 诊断 |
| `/mention` | 附加文件到会话 |
| `/model` | 选模型（含 reasoning effort） |
| `/fast` | 切换 Fast 服务档 |
| `/plan` | 进 plan 模式（可带 prompt） |
| `/goal` | 持久目标 set/view/pause/resume/clear |
| `/personality` | 沟通风格 |
| `/ps` | 查看后台终端及输出 |
| `/stop`（/clean） | 停止全部后台终端 |
| `/fork` | fork 当前 chat |
| `/app` | 在 ChatGPT 桌面 app 继续 |
| `/side`（/btw） | 临时 side chat |
| `/raw` | raw scrollback（=Alt+R） |
| `/resume` | 从保存列表恢复会话 |
| `/new` | 开新 chat（不清屏，可带名字） |
| `/review` | 审查工作区改动 |
| `/status` | 会话配置/token/限额 |
| `/usage` | 账户用量（daily/weekly/cumulative） |
| `/debug-config` | 打印 config 层级诊断 |
| `/statusline` | 配置底栏字段 |
| `/title` | 配置终端标题 |
| `/theme` | 语法高亮主题 |
| `/pets` | 终端宠物 |

自定义 prompt 以 `/prompts:<name>` 出现；启用中的 skill 也出现在 slash 列表。

## 三、CLI 子命令与常用 flag

子命令：`codex`（TUI）、`exec`（非交互，`exec resume --last`）、`resume`、`fork`、`apply`、`review`、`mcp list/get/add/remove/login/logout`、`cloud`、`login/logout`、`doctor`、`features enable/disable`、`plugin`、`sandbox`、`archive/unarchive/delete`、`app`、`app-server`、`remote-control`、`update`、`completion`。注意 `codex mcp-server` 已移除（改 app-server）；`--full-auto` 已 deprecated（等价 `--sandbox workspace-write`）。

常用 flag：`-m/--model`、`-s/--sandbox <read-only|workspace-write|danger-full-access>`、`-a/--ask-for-approval`、`-c key=value`（TOML 覆盖）、`-i/--image`、`-p/--profile`、`-C/--cd`、`--add-dir`、`--worktree`、`--search`、`--oss`、`--yolo`、`--approve-for-me`、`--enable/--disable <feature>`、exec 专属 `--json` / `-o` / `--ephemeral`。

## 四、Skills（对本项目自动发现最重要）

- **默认启用**，无 `features.skills` 开关（真实存在的只有 `features.skill_mcp_dependency_install`）。
- **发现目录**（不是 `~/.codex/skills`，是开放标准 `.agents/skills`）：
  - REPO：`$CWD/.agents/skills`，且 **从 CWD 逐级向上到 repo root 每一级都扫**
  - USER：`$HOME/.agents/skills`
  - ADMIN：`/etc/codex/skills`
  - SYSTEM：内置（skill-creator、plan 等）
- 格式：目录 + `SKILL.md`，frontmatter `name`、`description` 必填；可选 `agents/openai.yaml`（`policy.allow_implicit_invocation`、`dependencies.tools` MCP 依赖）。
- 调用：显式 `$skill-name` 或 `/skills` 菜单；隐式按 description 匹配。
- 禁用单个 skill：`[[skills.config]] path=... enabled=false`。

## 五、MCP 配置发现

官方："Codex stores MCP configuration in config.toml… `~/.codex/config.toml`, or scoped to a project with `.codex/config.toml` (trusted projects only)."

```toml
[mcp_servers.context7]                 # STDIO
command = "npx"                        # 必填
args = ["-y", "@upstash/context7-mcp"]
env_vars = ["LOCAL_TOKEN"]             # 允许转发的环境变量
[mcp_servers.context7.env]
MY_VAR = "value"

[mcp_servers.figma]                    # Streamable HTTP
url = "https://mcp.figma.com/mcp"
bearer_token_env_var = "FIGMA_OAUTH_TOKEN"
```

可选：`startup_timeout_sec`(10)、`tool_timeout_sec`(60)、`enabled`、`required`、`enabled_tools/disabled_tools`、`default_tools_approval_mode`、`tools.<t>.approval_mode`。发现途径：`codex mcp list` / `codex mcp get <name>` / TUI `/mcp` / 解析 TOML。

## 六、配置文件全景（`~/.codex/` = `$CODEX_HOME`）

| 路径 | 内容 |
|---|---|
| `config.toml` | 主配置（`[tui.*]`、`[mcp_servers.*]`、`[permissions.*]`、`[features]`、`[[skills.config]]` 等） |
| `auth.json` | 凭据（0600） |
| `AGENTS.md` / `AGENTS.override.md` | 全局指令 |
| `history.jsonl` | prompt 历史 |
| `sessions/YYYY/MM/DD/rollout-*.jsonl` | 会话 transcript（会压缩成 `.zst`） |
| `log/`、`rules/`、`<profile>.config.toml` | 日志 / execpolicy / profile 叠加层 |

优先级：CLI flags → 项目 `.codex/config.toml`（root→CWD，仅 trusted）→ profile → 用户 `~/.codex/config.toml` → 云管控 → `/etc/codex/config.toml` → 内置默认。

## 七、给本项目的落地要点

1. 默认快捷键库采用 §一 的源码级键表；注意四个易错点：Ctrl+T=transcript、Tab=排队、退出=Ctrl+C、编辑上条=Esc Esc。
2. skill 自动发现扫描：`$HOME/.agents/skills` + CWD→repo root 每级 `.agents/skills`；识别 `SKILL.md` frontmatter。
3. MCP 自动发现：解析 `~/.codex/config.toml` 与项目 `.codex/config.toml` 的 `[mcp_servers.*]` 表名（避免执行 `codex mcp list` 子进程）。
4. slash 命令与键位在 0.16x 迭代很快，数据采集自 rust-v0.162.1/main@2026-10-14。
