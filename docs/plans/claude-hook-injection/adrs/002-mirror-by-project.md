# ADR-002: claude 镜像目录从按端口命名改为按 integration id + 项目路径命名

## 状态

已采纳（2026-09-22，废弃 ADR-001 的"按端口命名 + 实例退出删除"部分；ADR-001 的
CLAUDE_CONFIG_DIR 注入通道本身保留）

## 背景

ADR-001 的镜像目录按实例端口命名（`claude-config/<port>/`），实例退出即删。运行
一个月后暴露两个问题：

1. **目录数随启动次数线性增长**：本机 41 个镜像目录实测仅对应 9 个工程（transcript
   hook attachment 的端口 ↔ 项目映射实证，见 `docs/research/claude-code-multi-project.md`）。
   同一工程每次启动都重建一份全量 symlink + plugins 深拷贝，纯浪费。
2. **`.claude.json` symlink 指向错误**：透传循环 `readdirSync(~/.claude)` 先把目录内
   `~/.claude/.claude.json` 当普通 entry 链进镜像，`dirname()` 修正逻辑（意图指向顶级
   `~/.claude.json`）成了死代码。后果：本机分裂出两套并行身份状态（直跑
   numStartups=436 写顶级文件，经 atr numStartups=111 写 `~/.claude/.claude.json`，
   machineID/userID 各异）。

调研（docs/research/claude-code-multi-project.md）确认：claude 对"项目"的固有键是
cwd（transcripts 桶、状态 map、memory 全按 cwd 组织），与 CLAUDE_CONFIG_DIR 指向
无关——镜像按项目命名与其模型同构、不冲突；同 cwd 多会话并行是官方支持场景。

## 决策

1. **目录结构改为两层**：`<ATR_DATA_DIR>/<integration-id>/<escapedCwd>/`。
   顶层按集成模块 id（`claude-code`）分——将来接 gemini-cli/codex 各占一个顶层目录；
   子目录按项目 cwd 转义命名（非字母数字 → `-`，与 claude `projects/<sanitized-cwd>`
   观感一致）。按模块 id 而非命令名分目录：`atr zclaude`（shell 函数）与 `atr claude`
   命中同一集成，命令名进路径会分裂镜像。
2. **hooks 回调端口从 settings.json 硬编码改为 env 引用**：URL 写成
   `http://127.0.0.1:${ATR_HOOK_PORT:-1}/api/hook`，实例端口经 PTY env
   `ATR_HOOK_PORT` 注入。未注入时打 `:1` 即刻 connection refused，无感开销。
   这是"同一项目多实例共享镜像"的前提（settings 内容与实例无关）。
3. **settings.json 固定注册全部事件**；实例级事件子开关（approvals/toolProgress/…）
   从"生成时挑事件"改为 `onHookPayload` 翻译时按事件类别过滤，设置面板语义不变。
4. **`.claude.json` symlink 修正指向顶级 `~/.claude.json`**（直跑会话的现行状态
   文件），透传循环显式排除目录内同名 entry。存量 `~/.claude/.claude.json`（111 次
   启动积累的第二身份）保留在磁盘不再被写，不做自动合并（改写用户主状态文件风险
   大于收益）；代价是经 atr 的会话首次对个别项目重弹一次 trust 确认。
5. **生命周期改共享**：启动时幂等重建，实例退出**不删**（同项目实例共享）；
   `cleanupConfigDirMirror` 移除。worker 启动时清理 `claude-config/` 与
   `claude-code/` 下纯数字命名的旧端口镜像残留（无 transcript 关联的已实证为
   无价值残留；物化凭据副本可弃——真凭据在 `~/.claude/.credentials.json`）。
6. **不设 `CLAUDE_CODE_PROJECT_DIR_NAME`**：它是官方给"每会话独立 config 目录"的
   projects 子目录改名变量；设了会把 atr 会话 transcripts 与直跑会话分桶。不设才
   保持"同 cwd 同桶"的 claude 默认行为。

## 理由

- 目录数从"随启动次数增长"收敛为"随工程数增长"（实测 41 → 9）
- hooks 与端口解耦后，settings.json 内容对同项目所有实例恒等，共享无冲突
- 对齐 claude 自身按 cwd 组织的固有模型（调研启示 1），transcripts 经 symlink
  穿透仍落 `~/.claude/projects/<escaped-cwd>/` 主桶，session picker 历史并列
- 修正双身份 bug 的根因（symlink 指向错误）

## 后果

- 多实例并发写顶级 `~/.claude.json` 是 last-writer-wins（claude 官方语义：原子写 +
  5 份备份 + 跨进程 watch，无锁），与桌面端 + 终端并行的官方场景一致，可接受
- symlink 对"claude 会原子写的文件"（credentials/stats-cache 等）可能被 rename
  替换成镜像内实体文件（调研实证）；共享镜像不随实例删，物化副本留存复用，比
  旧版"随实例删除"更安全。tokens 各自刷新，同账号不冲突
- plugins 副本仍每镜像深拷贝：漂移从"每实例"降到"每项目"；跨镜像共享中心副本
  复杂化明显，不做（留待未来）
- 旧版 `~/.atr/claude-config/`（旧数据目录整体）不在本清理范围，用户可手动删
