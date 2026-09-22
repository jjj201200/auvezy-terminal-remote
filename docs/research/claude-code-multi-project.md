# Claude Code 多项目（multi-project）机制调研

> 调研日期：2026-09-21 ｜ claude 版本：2.1.278（native，`~/.local/share/claude/versions/2.1.278`）
> 调研目的：为 atr（auvezy-terminal-remote）把 `CLAUDE_CONFIG_DIR` 镜像目录从"按实例端口命名"改为"按项目目录命名"的改版提供依据。
>
> 证据分三档标注：
> - **【官方】** = code.claude.com/docs 官方文档原文（附 URL）
> - **【实证】** = 本机（WSL2）文件系统 / 进程 / 二进制字符串的直接观察（附路径或偏移）
> - **【推测】** = 由上述证据推导，未获直接证明

---

## Q1. settings 配置层级与合并优先级

### 官方优先级（高 → 低）

**【官方】** [settings.md — "Settings precedence"](https://code.claude.com/docs/en/settings)：

1. **Managed settings**（组织部署的策略）：`managed-settings.json` 文件、MDM 策略、或 claude.ai 控制台的 server-managed settings。任何用户侧配置都覆盖不了它（少数 security-sensitive key 例外）。
2. **Command line**：`claude --settings`（仅本会话）。
3. **Project local**：项目内 `.claude/settings.local.json`（个人、本项目，不进 git）。
4. **Shared project**：项目内 `.claude/settings.json`（全团队共享、进 git）。
5. **User**：`~/.claude/settings.json`（个人、所有项目）。

> 原文："When the same key appears in more than one place, Claude Code uses the value from the highest level that sets it."

环境变量不属于这个层级栈，与 settings key 的胜负按"每对变量各自约定"决定（如 `ANTHROPIC_MODEL` 覆盖任何文件里的 `model`）【官方】[env-vars.md — "Precedence"](https://code.claude.com/docs/en/env-vars)。

**【官方】** managed-settings.json 的系统目录（[managed-settings.md](https://code.claude.com/docs/en/managed-settings)）：

- macOS：`/Library/Application Support/ClaudeCode/managed-settings.json`
- Linux/WSL：`/etc/claude-code/managed-settings.json`
- Windows：`C:\Program Files\ClaudeCode\managed-settings.json`（旧路径 `C:\ProgramData\ClaudeCode\` 已不读）

**【实证】** 本机 debug 日志（`/home/jjj201200/.claude/debug/147bf88b-...txt`，2026-08-16，v2.1.2xx）显示 MDM/managed 层最先探测：

```
[DEBUG] MDM settings load completed in 20ms
[DEBUG] Broken symlink or missing file encountered for settings.json at path: /etc/claude-code/managed-settings.json
```

### CLAUDE_CONFIG_DIR 与 user settings 的关系

**【官方】** [settings.md](https://code.claude.com/docs/en/settings)：

> "On Windows, `~/.claude` means `%USERPROFILE%\.claude`. To keep the home-directory files somewhere else, set `CLAUDE_CONFIG_DIR`; Claude Code then stores your settings, session history, and plugins there instead."

即：**设置 `CLAUDE_CONFIG_DIR` 后，user settings 的位置变为 `$CLAUDE_CONFIG_DIR/settings.json`**（第 5 层整体搬家）。

**【实证】** atr 镜像（`~/.atr/claude-config/<port>/settings.json`，含 atr hooks 的合成版）被 claude 当作 user settings 读取——atr 现行机制即依赖此行为（`backend/src/integrations/claude-code/config-dir-mirror.ts`）。

---

## Q2. 会话/transcript 按项目组织：转义规则与归属

### 官方转义规则原文

**【官方】** [sessions.md — "Where transcripts are stored"](https://code.claude.com/docs/en/sessions)：

> "By default, Claude Code stores transcripts as JSONL at `~/.claude/projects/<project>/<session-id>.jsonl`, where `<project>` is your working directory path with **non-alphanumeric characters replaced by `-`**. For a working directory whose converted name **exceeds 200 characters**, Claude Code truncates the name to 200 characters and **appends a hash of the full path**, so the directory name stays within filesystem limits."

要点：
- 转义对象是**整个 working directory 绝对路径**（不是 basename）；
- 非"字母数字"的字符（含 `/`、`.`、空格、中文等）→ `-`；
- 超长截断至 200 字符 + 追加 full-path hash。

**【官方】** 二进制内 JSDoc（见下"二进制证据"）使用的术语是 `<sanitized-cwd>`：auto memory 默认路径为 `~/.claude/projects/<sanitized-cwd>/memory/`。

### 本机实证样本

**【实证】** `/home/jjj201200/.claude/projects/`（19 个目录）：

| cwd（由 jsonl 内 `cwd` 字段与 `.claude.json` projects map 还原） | 目录名 |
|---|---|
| `/mnt/d/github/observer` | `-mnt-d-github-observer` |
| `/mnt/c/Users/jjj20` | `-mnt-c-Users-jjj20`（**大小写保留**） |
| `/mnt/e/CDDA/cdda-windows-with-graphics-and-sounds-x64-2026-06-06-1535` | `-mnt-e-CDDA-cdda-windows-...`（`CDDA` 大写保留） |
| `/tmp` | `-tmp` |

规律：开头 `/` 也变成 `-`（所以名字以 `-` 开头）；字母大小写原样保留。

### 会话归属判定

- **【官方】** "A session is a saved conversation **tied to a project directory**"（sessions.md）。归属依据是**会话的 working directory**。
- **【实证】** 每个 `<session-id>.jsonl` 内部记录 `cwd`、`sessionId`、`version`、`gitBranch` 等字段（抽检 `-mnt-d-github-observer/c3c27400-....jsonl`：`cwd=/mnt/d/github/observer`，与所在目录名的转义结果一致）。
- **【官方】** `--resume <session-id>` 可跨目录调用：先在当前项目目录及其 git worktrees 找，找不到再全机其它项目里找，**只有唯一命中才解析**（v2.1.223+，sessions.md）。跨项目重复的 transcript 会被拒绝 resume。

### 命名算法的版本演化（重要线索）

**【实证】** 2.1.278 二进制（bun 打包，`grep -abo` 提取）字符串表与导出表（偏移 ~220398996 的 barrel 模块）中存在以下符号：

```
getProjectDir / getProjectKey / getProjectsDir
legacyDerivedProjectKey      ← "旧版派生算法"
listProjectDirNamesV5        ← "V5 目录命名"
listedProjectKey
workspaceV5Of
slugCollisionGuardFoldsCase  ← 大小写折叠（case-folding）碰撞防护
MAX_SANITIZED_LENGTH         ← 对应官方文档的 200 字符上限
sanitizePath
normalizePathForCwdCompare
recordedCwdCollidesWithProjectResolved / recordedCwdIsWithinOwnWorktrees
```

同一符号集在 2.1.273 与 npm 包 2.1.261 中同样存在（各版本字符串池偏移不同），说明该机制至少自 2.1.261 起稳定存在。

**【实证+推测】** 转义白名单的细微出入：官方文档说 "non-alphanumeric characters replaced by `-`"（字面上 `_` 也应被替换）；但二进制字符串池存在 `[^a-zA-Z0-9_-]`、`^[a-zA-Z0-9_-]+$` 等正则（偏移 93674510 等多处），提示现行算法可能保留 `_`（即"字母数字+下划线+连字符"白名单）。因函数实现体已编译为 bun bytecode（`// @bun @bytecode`），无法直接读出函数体确认。**结论：`_` 是否保留存在不确定性；atr 若需自行复算转义名，只能依赖官方文档口径，或实测验证。**（本机 projects 目录样本中无 `_`/`.` 路径可佐证。）

### 官方提供的显式命名机制：CLAUDE_CODE_PROJECT_DIR_NAME

**【官方】** [sessions.md — "Name the project directory yourself"](https://code.claude.com/docs/en/sessions)、[env-vars.md](https://code.claude.com/docs/en/env-vars)（要求 v2.1.234+）：

> "To choose the name yourself, set `CLAUDE_CODE_PROJECT_DIR_NAME` alongside `CLAUDE_CONFIG_DIR`. Claude Code then stores that session's transcripts and auto memory under your name. **This suits a host that embeds Claude Code and gives each session its own config directory.**"

三条规则（原文归纳）：
1. **必须同时设置 `CLAUDE_CONFIG_DIR`**——否则所有项目的 transcripts/memory 会并进一个目录（claude 会忽略该变量）；
2. 名字须为 **1–64 个字母/数字/连字符/下划线**，且不能用 Windows 设备名（如 `con`），否则回退到派生名；
3. 只从**启动 claude 的 shell 环境**读取一次，settings 文件 `env` 块不能设置。

行为语义：同一 `CLAUDE_CONFIG_DIR` 下，带名字启动 → 读写 `projects/<名字>/`；不带名字启动 → 回到读写派生目录。两种名字下的历史 session 都留在磁盘上，session picker 按 `Ctrl+A` 可列出该 config 目录下**所有项目目录**的会话，`--resume <id>` 两种名字下都能找到。

> 对 atr 的意义：**官方已经为"宿主给每个实例独立 config 目录"这一场景提供了项目目录命名变量**，与 atr 镜像机制是同一问题域（详见文末启示）。

---

## Q3. 顶级状态文件 `.claude.json`

### 官方语义

**【官方】** [claude-directory.md — `~/` 树下的 `.claude.json` 条目](https://code.claude.com/docs/en/claude-directory)：

> "App state and UI preferences. Read at session start for your preferences and MCP servers. Claude Code writes back to it when you change settings in `/config` or approve trust prompts."
>
> "Holds state that does not belong in settings.json: theme, OAuth session, **per-project trust decisions**, your personal MCP servers, and UI toggles."
>
> "The `projects` key tracks per-project state like trust-dialog acceptance and last-session metrics. Permission rules you approve in-session go to `.claude/settings.local.json` instead."

注意它在官方目录树中挂在 **`~/` 根下**（与 `.claude/` 平级），即官方现行文档仍把状态文件描述为**顶级 `~/.claude.json`**。

**【实证】** 本机 `/home/jjj201200/.claude.json`（93030 字节）顶层键含 `oauthAccount`、`mcpServers`、`numStartups`、`machineID`、`userID`、`anonymousId`、`installMethod`、`projects` 等；`projects` map（16 个键，键为**原始 cwd 绝对路径**，非转义名）每个项目记录：

```
hasTrustDialogAccepted, allowedTools, mcpServers, lastSessionId,
lastSessionFirstPrompt, lastStartTime, lastSessionMetrics,
lastTotalInputTokens / OutputTokens / CacheRead/CacheCreation,
lastLinesAdded / Removed, lastCost, lastDuration, exampleFiles,
enabledMcpjsonServers / disabledMcpjsonServers, gitBranch 相关缓存等
```

**【官方】** `claude project purge <path>` 会删除一个项目的全部状态：projects/ 下 transcripts 与 auto memory、该项目的 `tasks/`、`debug/`、`file-history/` 条目、`history.jsonl` 中匹配行、**以及 `.claude.json` 里该项目的 entry**（claude-directory.md — "Clear local data"）。

### 本机两文件之谜：`~/.claude.json` vs `~/.claude/.claude.json`

**【实证】** 本机两个文件都存在、都"活着"：

| 文件 | 大小 | 最后写入 | numStartups | machineID | userID | projects 数 |
|---|---|---|---|---|---|---|
| `/home/jjj201200/.claude.json` | 93030 | **持续更新**（采样时 21:12:17 birth，21:08+ 多次变化） | 436 | `467528229a...` | `e326c9b5...` | 16（全部项目） |
| `/home/jjj201200/.claude/.claude.json` | 73953 | 20:42:30（与 atr 镜像 `42091` 活跃时刻一致） | 111 | `c73dfdfee...` | `64ac40fc...` | 9（恰好全是经 atr 跑过的项目） |

两者 `oauthAccount.emailAddress` 相同（同一账号登录），但 machineID / userID / numStartups 完全独立——**两套并行身份状态**。

**谁在写哪个（判定过程）**：

1. **顶级 `~/.claude.json` = 无 `CLAUDE_CONFIG_DIR` 时的现行读写目标**。证据：
   - 【实证】本调研所在会话进程（PID 60594，`claude --settings ~/.claude-zhipu/gateway.json`，env 中**无** `CLAUDE_CONFIG_DIR`）运行期间，顶级 `~/.claude.json` mtime 每分钟级更新；`~/.claude/backups/` 中 `.claude.json.backup.<epoch-ms>` 保留 5 份轮转（21:13–21:23 连续生成，93030 字节与顶级文件同大小）。
   - 【实证】旧版 debug 日志（2026-08-16）原子写目标即 `/home/jjj201200/.claude.json`。
2. **`~/.claude/.claude.json` = `$CLAUDE_CONFIG_DIR/.claude.json` 语义的落点**。证据：
   - 【实证】atr 镜像目录（`~/.atr/claude-config/` 下 40 个）中存在 `.claude.json` symlink 的全部指向 `/home/jjj201200/.claude/.claude.json`（36 字符目标，无一例外，26 个实测 + 其余为悬挂/已清理残留）；经 atr 跑的 claude（`CLAUDE_CONFIG_DIR=<镜像>`）穿透该 symlink 写入，20:42 的写入与镜像 42091 活跃时间吻合；
   - 【实证】该文件的 projects map（9 项：open-terminal-remote / df-market / observer-v1 / observer / deepseek-harness / dsh-explore / 两个 CDDA）正是经 atr 跑过的项目集合；其 `lastSessionId`（e36e3452，v2.1.259）的 transcript 存在于共享的 `~/.claude/projects/-mnt-d-github-open-terminal-remote/` —— 状态文件分裂、transcript 共享，与镜像"symlink 透传 projects + `.claude.json` 重定向"的结构完全自洽。

**结论：claude 实际读写的状态文件路径是「`CLAUDE_CONFIG_DIR` 未设 → `~/.claude.json`（顶级）；已设 → `$CLAUDE_CONFIG_DIR/.claude.json`」**。【实证】（官方文档佐证见 Q4——env-vars 对 CLAUDE_CONFIG_DIR 的描述只列 "settings, session history, plugins"，**未明说** `.claude.json`；但 claude-directory.md 官方示例 `alias claude-work='CLAUDE_CONFIG_DIR=~/.claude-work claude'` 的"多账号并行"用途隐含整个身份迁移。行为以本机实证为准。）

**`~/.claude/.claude.json` 是怎么诞生的（推测）**：历史上存在一次 `CLAUDE_CONFIG_DIR` 显式等于 `~/.claude`（或以 `~/.claude` 为值的等效重定向）的运行，claude 在 `$CONFIG_DIR/.claude.json` 初始化了全新状态（新 machineID、numStartups 从 1 计数）。此后 atr 镜像的透传循环把它当作 `~/.claude/` 的普通 entry 逐实例链接进镜像，成为经 atr 会话的固定状态落点。诞生时刻无日志可考，**此段为推测**；但"它现在是经 atr 会话的状态文件"是实证。

**顺带解开的 atr 现状 bug（实证）**：`config-dir-mirror.ts` 中 `topLevelState = join(dirname(realConfigDir), '.claude.json')`（→ `~/.claude.json`）那段逻辑实际是**死代码**——透传循环 `readdirSync(~/.claude)` 先一步把目录内已存在的 `.claude.json` entry（即 `~/.claude/.claude.json`）symlink 进镜像，`if (!existsSync(linkPath))` 幂等检查随后跳过。这就是"代码想指向 `~/.claude.json`、磁盘全部指向 `~/.claude/.claude.json`"的原因，且**官方从未把 `~/.claude/.claude.json` 作为默认位置**——本机的第二身份是这条意外链路累积出来的。

---

## Q4. `CLAUDE_CONFIG_DIR` 重定向语义

### 官方原文

**【官方】** [env-vars.md — Variables 表 `CLAUDE_CONFIG_DIR` 行](https://code.claude.com/docs/en/env-vars)：

> "Override the configuration directory (default: `~/.claude`). **All settings, session history, and plugins are stored under this path.** For credentials, see where Claude Code stores credentials. Useful for running multiple accounts side by side: for example, `alias claude-work='CLAUDE_CONFIG_DIR=~/.claude-work claude'`. Set it in your shell, user settings, or managed settings. **Ignored in project and local settings.**"

补充（同页）：值必须是**绝对路径**（二进制错误串 "the configuration home (CLAUDE_CONFIG_DIR) is not an absolute path"【实证，偏移 97827548 附近】）；启动后改动不生效（"changed after Claude Code started: set it in the shell, not a settings file, and restart"【实证，同偏移区】）。

### 跟随重定向的路径

| 路径 | 证据 |
|---|---|
| user `settings.json` → `$CONFIG_DIR/settings.json` | 【官方】settings.md "stores your settings … there instead"；【实证】atr 镜像 settings.json 生效 |
| `projects/<sanitized-cwd>/`（transcripts + auto memory） | 【官方】sessions.md 配置表 "Move storage off ~/.claude → CLAUDE_CONFIG_DIR" |
| `plugins/` | 【官方】env-vars 原文 "…and plugins" |
| `.credentials.json` → `$CONFIG_DIR/.credentials.json` | 【官方】[authentication.md — credential management](https://code.claude.com/docs/en/authentication)："If you've set the `CLAUDE_CONFIG_DIR` environment variable, Claude Code keeps the `.credentials.json` file under that directory instead … so a session with a different `CLAUDE_CONFIG_DIR` reads a different entry"（macOS Keychain entry 也按该目录分键） |
| 状态文件 `.claude.json` → `$CONFIG_DIR/.claude.json` | 【实证】见 Q3（官方文字未列，行为确凿） |
| 其余运行时子目录（`shell-snapshots/`、`session-env/`、`file-history/`、`tasks/`、`debug/`、`paste-cache/`、`backups/`、`history.jsonl`、`stats-cache.json`、`skills/`、`agents`相关、`keybindings.json`、`themes/` 等） | 【实证】这些名字全部相对 `~/.claude` 解析（二进制字符串池集群 @96411956：`file-history`、`session-env`、`shell-snapshots`、`backups` + cleanupPeriodDays 逻辑；claude-directory.md 的 `~/.claude/` 树）。atr 镜像靠 symlink 透传后，claude 在镜像内对这些路径的读写**穿透回 `~/.claude` 真身** |

**【实证】运行时子目录的真实形态**（`ls ~/.claude/`，2026-09-21）：`projects/`、`session-env/`（218 个，**按 session UUID 命名**，不按项目）、`shell-snapshots/`、`file-history/`、`plugins/`、`skills/`、`hooks/`、`tasks/`、`debug/`、`sessions/`、`jobs/`、`backups/`、`ide/`、`telemetry/`、`history.jsonl`、`stats-cache.json`、`.credentials.json`、`CLAUDE.md`、`settings.json` 等。**【官方】** 其中 `todos/`、`statsig/`、`logs/` 是 legacy 目录，新版已不写（claude-directory.md — "Cleaned up automatically" 表格脚注）。

### 不跟随重定向的路径

| 路径 | 证据 |
|---|---|
| `~/.local/share/claude/`（native 安装目录：`versions/2.1.273|274|278` 二进制本体） | 【实证】与 CONFIG_DIR 无关，位于 XDG data 目录；`installMethod: native`（`.claude.json` 内字段） |
| （语义上）顶级 `~/.claude.json` | 无重定向时的默认状态文件；重定向后**被 `$CONFIG_DIR/.claude.json` 取代**（见 Q3），并非"迁移"而是"换文件"——旧顶级文件留在原地不再读写 |
| `/etc/claude-code/managed-settings.json` 等系统策略目录 | 【官方】managed-settings.md，固定系统路径 |

### 二进制中的相关防护（实证）

`/home/jjj201200/.local/share/claude/versions/2.1.278` 字符串池（偏移按 `grep -abo`）：

- @97827548 附近：`the configuration home (CLAUDE_CONFIG_DIR) is not an absolute path`；`where your own settings are found (CLAUDE_CONFIG_DIR, the HOME it defaults from, or the cowork settings switch) changed after Claude Code started…`
- @92236588 附近：`CLAUDE_CONFIG_DIR no longer names <path>, where the v5 storage backend was built at start-up; init() loads its config without it` —— 证实存在 **"v5 storage backend"** 概念，CONFIG_DIR 在启动时定格。
- @99367939 附近：`legacy_global_config`、`Not watching ~/.claude.json for other processes: the fs.watchFile fallback is off for this process`、`Watching ~/.claude.json through the storage interface ended: …` —— 状态文件有**跨进程 watch** 通道（fs.watch / fs.watchFile 轮换，见 Q5）。

---

## Q5. 多实例 / 多项目并发

### 状态文件写入：temp + rename 原子写 + 5 份备份轮转 + 跨进程 watch

**【实证】** 2026-08-16 debug 日志（当时版本）：

```
[DEBUG] Writing to temp file: /home/jjj201200/.claude.json.tmp.602828.6adf0a17a960
[DEBUG] Renaming /home/jjj201200/.claude.json.tmp.602828.6adf0a17a960 to /home/jjj201200/.claude.json
[DEBUG] File /home/jjj201200/.claude.json written atomically
```

temp 命名模式 `<target>.tmp.<pid>.<rand>`——同目录 write-then-rename，进程崩溃不留半截文件。**【实证】** 2.1.278 字符串池（@99922608 区）仍有该实现，且更完善：`Preserving file permissions` / `Setting permissions for new file` / `fchmod unsupported on this filesystem` / `fsync unsupported` / `closeSync also failed after temp write error` / `Temp file written successfully, size:`。

**【官方】** backups 轮转："Earlier versions of `~/.claude.json`, copied when Claude Code rewrites the file. Claude Code keeps the five newest, plus a copy of any version it couldn't parse."（claude-directory.md）**【实证】** `~/.claude/backups/` 实测 5 份 `.claude.json.backup.<epoch-ms>`。

**【实证】** 跨进程感知：二进制含 "Not watching ~/.claude.json for other processes…"（fs.watchFile 轮换开关）与 "Watching ~/.claude.json through the storage interface ended"——一个进程改状态，其它进程能感知刷新。【推测】这服务于桌面端/多终端同时开的场景，但**没有文件锁**：两个进程"同时写"靠原子写保证文件不损坏，逻辑上仍是 last-writer-wins（整文件覆盖）。

### 会话级并发：`sessions/` 目录

**【官方】** claude-directory.md：

> "`sessions/`: holds one small file per running session, **used to detect concurrent sessions and crashes**. It isn't part of the age-based sweep: Claude Code removes each file when its session exits and clears crash leftovers on the next launch."

**【实证】** `~/.claude/sessions/` 形态：`<pid>.json` + `<pid>.<sha256>.key` 成对文件（如 `128772.2827...key`，mtime 与 atr 实例启动时刻一致）——按进程 PID 登记。

### projects 目录：天然无冲突

**【实证+官方】** transcripts 按 `<sanitized-cwd>/<session-uuid>.jsonl` 分桶，每个会话一个独立文件，多进程并行追加不同文件，无共享写冲突；`.claude.json` 的 `projects` map 是唯一的全局汇聚点（per-project entry 整体覆盖）。同 cwd 的多个并行会话是官方支持的场景（session picker 列出当前项目全部会话；`sessions/` 并发检测即为此设计）。

### 已知的并发敏感点（对 atr 重要）

1. **【实证】原子写会"打断" symlink**：rename 到 symlink 路径时替换的是 symlink 本身。实证：镜像 `42091/.credentials.json` 在 atr 建镜像时本应是 symlink 透传（`~/.claude/.credentials.json` 当天 09:28 已存在，镜像 10:14 建立），现在却是 **524 字节的真文件**（18:11 写入）——claude 的原子写把 symlink 替换成了实体文件。**任何"claude 会重写的文件"都不能靠 symlink 稳定共享**。
2. **【实证】** 2.1.278 字符串池出现 `Refusing to write through symlink` / `Writing through symlink:` / `Refusing to write into symlinked directory: <path>. Resolve the symlink and pass the real target path explicitly.`（@99922300 区）——新版对 symlink 写入有显式检测，部分场景拒绝、部分放行（具体策略在 bytecode 中，无法完全确认；与上面 `.credentials.json` 的实际替换行为并存，说明放行路径仍走 rename-替换语义）。
3. **【实证】** 身份/状态分裂：并行的"直跑"与"经 atr"进程各写各的 `.claude.json`（Q3），`numStartups`、trust 状态、lastSession 指标互不可见——**这不是崩溃级问题，但意味着两套环境的项目级状态（信任与否、统计、exampleFiles 缓存）各自积累**。

---

## Q6. 项目级 `.claude/` 目录组织

**【官方】** [claude-directory.md — 项目树](https://code.claude.com/docs/en/claude-directory)：

```
your-project/
├── CLAUDE.md            # 项目指令,每次会话加载(也可放 .claude/CLAUDE.md)
├── .mcp.json            # 团队共享的项目级 MCP servers(项目根,不在 .claude/ 内)
├── .worktreeinclude     # worktree 创建时复制哪些 gitignored 文件
└── .claude/
    ├── settings.json        # 团队共享(进 git):permissions/hooks/statusLine/model/env...
    ├── settings.local.json  # 个人本地(自动加入全局 git excludes)
    ├── rules/               # 项目指令拆分,可按 paths: 条件加载
    ├── skills/              # 技能(SKILL.md + 支持文件)
    ├── commands/            # 命令——官方明言"Commands and skills are now the same
    │                        #  mechanism. For new workflows, use skills/ instead"
    ├── agents/              # 子代理定义(如 code-reviewer.md)
    ├── output-styles/       # 自定义输出风格
    ├── workflows/           # 工作流
    └── agent-memory/        # 子代理项目级持久记忆(memory: project)
                             # (本地变体 .claude/agent-memory-local/,跨项目 ~/.claude/agent-memory/)
```

用户级（`~/.claude/`）对应：`CLAUDE.md`、`settings.json`、`skills/`、`commands/`、`rules/`、`output-styles/`、`keybindings.json`、`themes/`、`agent-memory/`、`projects/` 等——**同名机制在 user 级与 project 级成对出现**，project 级覆盖 user 级。

`settings.local.json` 的一个关键行为（**【官方】**）："If you start Claude Code in a subdirectory of a git repository, it reads and writes that file **at the repository root**"——project local 作用域锚定 git 仓库根，不是字面 cwd。worktree 场景使用主 checkout 根的文件。

auto memory（**【官方】** memory 机制，与本调研相关部分）：每项目独立目录 `~/.claude/projects/<sanitized-cwd>/memory/`，MEMORY.md 为索引（前 200 行/25KB 会话启动加载），不会被 age-based sweep 删除（仅长期空目录才清）。

---

## 与预期不符的事实汇总（显著标注）

1. **`CLAUDE_CONFIG_DIR` 连 `.claude.json` 顶级状态文件一起重定向**（→ `$CONFIG_DIR/.claude.json`）。官方 env-vars 原文只列 "settings, session history, plugins"，未提状态文件；但本机实证（双身份分裂 + 镜像 symlink 穿透写入 + lastSessionId 闭环验证）确凿。**atr 现有注释对该语义的理解是正确的**。
2. **本机已实际存在两套并行身份状态**：直跑写 `~/.claude.json`（numStartups 436），经 atr 写 `~/.claude/.claude.json`（numStartups 111），同账号、不同 machineID/userID。根因是 atr 透传循环把 `~/.claude/.claude.json` 当普通 entry 链进镜像（`config-dir-mirror.ts` 的 `dirname()` 修正逻辑是死代码，从未生效）——**代码意图（指向顶级 `~/.claude.json`）与磁盘现实（指向 `~/.claude/.claude.json`）从 2026-08-16 起就分叉**。
3. **symlink 透传对"claude 会重写的文件"不可靠**：原子写 rename 会把 symlink 替换成实体文件（`.credentials.json` 实证）。新版还有 `Refusing to write through symlink` 防护字符串，行为未完全公开。
4. **目录转义算法有版本演化**（`legacyDerivedProjectKey` / `listProjectDirNamesV5` / `slugCollisionGuardFoldsCase`），且官方文档口径（"non-alphanumeric"）与二进制正则（`[^a-zA-Z0-9_-]`，似保留 `_`）存在细微不一致——外部工具不应硬编码复算转义名。
5. **官方提供了 `CLAUDE_CODE_PROJECT_DIR_NAME`**（v2.1.234+）：专为"宿主嵌 claude、每实例独立 config 目录"场景设计的 projects 子目录显式命名变量——这正是 atr 镜像的问题域，此前 atr 设计未利用它。

---

## 对 atr 镜像改版的启示

以下各条由上述事实直接推导，不引入新设计：

1. **"按项目目录命名镜像"与 claude 自身的多项目模型同构，方向正确**。claude 对"项目"的固有键是 **cwd**：transcript 桶 `projects/<sanitized-cwd>/`、状态 `projects` map 键、`history.jsonl` 行、auto memory 全部按 cwd 组织，与 `CLAUDE_CONFIG_DIR` 指向哪里无关（Q2/Q3）。镜像目录叫什么名字只影响"哪些实例共享同一份 config 目录"，不会干扰 claude 内部的按项目分桶——因此把镜像从"按端口"改为"按项目目录命名"，与 claude 机制不冲突；同项目多实例共享一个镜像时，transcripts 仍按 cwd 落在同一 `projects/<sanitized-cwd>/` 下，与官方"同 cwd 多会话并行"场景一致（Q5）。
2. **优先评估直接采用官方 `CLAUDE_CODE_PROJECT_DIR_NAME`**（v2.1.234+，本机 2.1.278 满足）：它是官方给"宿主每实例独立 config 目录"准备的命名开关，可让镜像内的 projects 子目录名稳定、可读（1–64 位 `[A-Za-z0-9_-]`），避免依赖有版本演化且文档口径与实现有出入的转义算法（V5/legacy）。注意三条官方约束：必须与 `CLAUDE_CONFIG_DIR` 同设、只能 shell 环境注入（atr 的 PTY env 注入方式天然满足）、不设即回退派生名。
3. **改版是修正 `.claude.json` symlink 指向的时机**：应指向**顶级 `~/.claude.json`**（直跑会话的现行状态文件），而不是现状的 `~/.claude/.claude.json`。同时必须处理存量分裂：`~/.claude/.claude.json` 里 111 次启动积累的 trust 状态/项目配置是真实用户数据，切换目标后经 atr 的会话将"回到"主状态——是否/如何合并（例如按 projects map 逐项搬移）需要在设计里显式决策，不能静默丢弃。
4. **不要用 symlink 共享任何"claude 会原子写"的文件**（`.credentials.json` 已实证被替换成实体文件；`.claude.json`、`stats-cache.json`、`history.jsonl` 同理高风险）。官方行为是 rename 覆盖 symlink 本身。镜像对这些文件要么接受"实例退出即弃"的实体副本，要么在启动时物化快照 + 退出时有选择地回写——但不能假设 symlink 会长期存活。此点同时警示：**镜像退出清理（rm -rf 镜像目录）会连带删掉被物化的凭据副本**，现状的"残留无害"假设对这类文件不成立。
5. **多实例并发写共享 `.claude.json` 是"最后写胜出"**，无文件锁；官方靠原子写 + 5 份备份 + 跨进程 watch 容忍并行（桌面 + 终端同时开是官方场景）。同项目多实例共享一个按项目命名的镜像后，这个并发面从"每实例一份"收敛为"该项目共享一份"，`projects` map 内 per-project entry 的覆盖粒度与 claude 原生多终端场景相同——可以接受，但 atr 文档应明确：lastSession 指标类字段会互相覆盖，属官方语义内行为。
6. **plugins 副本的强校验约束在共享镜像下变得更简单也更重要**：官方强校验插件注册表路径位于当前 `CLAUDE_CONFIG_DIR` 内（atr 已实证并深拷贝归一）。按项目命名后，同项目多实例天然共享同一份 plugins 副本，注册表不再需要"每端口一份"地重复归一；但不同项目镜像各自持有副本，安装/更新插件会在各镜像间产生漂移——设计时需决定共享策略（例如全部镜像指向同一物理副本 + 物化时机）。

---

## 来源清单

**官方文档（code.claude.com/docs，2026-09-21 抓取）**

- Settings files and precedence: <https://code.claude.com/docs/en/settings>
- Environment variables（含 `CLAUDE_CONFIG_DIR`、`CLAUDE_CODE_PROJECT_DIR_NAME` 定义行）: <https://code.claude.com/docs/en/env-vars>
- Explore the .claude directory（`~/` 树、`.claude.json` 条目、application data 全表、`claude project purge`）: <https://code.claude.com/docs/en/claude-directory>
- Sessions（transcript 存储与转义规则、`--resume` 跨项目、Name the project directory yourself）: <https://code.claude.com/docs/en/sessions>
- Deploy managed settings（系统目录路径）: <https://code.claude.com/docs/en/managed-settings>
- Authentication（credentials 与 `CLAUDE_CONFIG_DIR` 关系）: <https://code.claude.com/docs/en/authentication>

**本机实证（WSL2，2026-09-21）**

- `/home/jjj201200/.claude/`（目录形态）、`projects/`（19 个转义名）、`sessions/`（PID 文件）、`backups/`（5 份轮转）、`debug/147bf88b-....txt`（MDM 加载顺序 + 原子写日志）
- `/home/jjj201200/.claude.json`（93030B，16 projects，mtime 实时更新）与 `/home/jjj201200/.claude/.claude.json`（73953B，9 projects，20:42 止）对比
- `/home/jjj201200/.atr/claude-config/`（40 个镜像目录，`.claude.json` symlink 全量核对：26 个有效 symlink 全部指向 `~/.claude/.claude.json`）
- 会话闭环验证：`~/.claude/.claude.json` 的 `lastSessionId` → `projects/-mnt-d-github-open-terminal-remote/e36e3452-....jsonl`（cwd 字段一致）
- 二进制 `/home/jjj201200/.local/share/claude/versions/2.1.278`（同符号亦见于 2.1.273 与 npm `@anthropic-ai/claude-code@2.1.261`）：`grep -abo` 定位——`legacyDerivedProjectKey`/`listProjectDirNamesV5`/`slugCollisionGuardFoldsCase`/`MAX_SANITIZED_LENGTH`（@91883900 区、@220398996 barrel）、`[^a-zA-Z0-9_-]`（@93674510）、`CLAUDE_CONFIG_DIR is not an absolute path`（@97827548）、`v5 storage backend`（@92236588）、`Not watching ~/.claude.json for other processes`（@99367939）、原子写工具串（@99922608）、`Refusing to write through symlink`（@99922300 区）
- atr 仓库：`backend/src/integrations/claude-code/config-dir-mirror.ts`（含 git 历史 e786d28 / f291387）、生产 dist `cli.js` 同逻辑核对
