# TUI 快捷键/命令全集 + Codex 集成与 Skill/MCP 自动发现

> 状态：已实现（2026-10-14）。对应 commits：5419f72 / 6dc181e / （frontend commit）。

## 背景与决策

用户需求：为 claude / codex 两个 TUI 提供"完整的默认快捷键与指令"（分好组），
并做 codex 集成——"常用"与"会话"增加 skill / mcp 自动发现，modal 选择后输入到
输入框。调研先行（`docs/research/claude-code-shortcuts-commands.md` /
`codex-cli-shortcuts-commands.md`）。

用户拍板的两个决策：

1. **分组方案**：每个 TUI 一个大组（不是语义分组重构）。命令侧现有 7 个语义组
   本身就是 Claude 命令，保留不动；新增 `claude` / `codex` 两个全集命令组。
   快捷键侧新增 `claude-code` / `codex` 两组 TUI 专属键位。
2. **数量与默认值**：全部收录（不是精选 25 条），**全部默认 enabled=false**，
   常用度排前（会话 → 模型 → 工作流 → 配置 → MCP → 账号 → 帮助）。
3. **迁移**：条目级合并——以 `group + data/command` 为键，内置默认里用户配置
   缺失的条目自动追加到尾部（`ensureDefaultUserConfig` 内
   `mergeBuiltinActionEntries`）。副作用：用户删过的内置条目升级后复活（可再删）。

## 数据

- `shared/src/defaults.ts`：`SHORTCUT_GROUPS` +2 组（claude-code 36 条、codex 42
  条，与通用组字节重复的键不重复收录，版本/平台差异写进 desc）；
  `COMMAND_GROUPS` +2 组（claude 109 条、codex 49 条）。清理废弃命令
  （/vim、/pr_comments 删除，/bashes 更名 /tasks）。
- 数据来源版本：Claude Code v2.1.28x 官方文档（2026-10）；Codex rust-v0.162.1
  官方文档 + keymap 源码。

## Skill / MCP 自动发现

- 协议：`shared/src/discovery.ts`（DiscoveredSkill / DiscoveredMcpServer /
  DiscoveryResponse；`invoke` 字段携带 prefill 文本）。
- backend：`backend/src/discovery/`（skills-scanner + mcp-scanner，全固定目录
  只读、零新依赖：SKILL.md frontmatter 轻量解析 + TOML 表头轻量解析）。
  codex 侧按官方规则扫 `.agents/skills`（CWD 向上到 git root 每级），MCP 解析
  `~/.codex/config.toml` 的 `[mcp_servers.*]`。路由 `GET /api/discovery?instanceId=`
  （broker 端，鉴权；`DiscoveryError` 子类）。
- frontend：`DiscoveryModal`（presenter `useDiscoveryPresenter`）+ Toolbar
  「常用」「会话」组行尾固定入口按钮；skill → prefill invoke，MCP → 直发 /mcp。

## 测试与 smoke

- shared 86 测试（合并迁移 4 场景 + 数据哨兵）；backend 767 测试
  （discovery 14 个）；frontend 184 测试。
- smoke（隔离 HOME + 端口 13737）：老配置升级后 GET /api/config 补齐 4 个新组 ✓；
  /api/discovery 错误路径 400/404 ✓；真实实例 cwd 下发现 2 skills + 2 MCP
  （跨 user/project 与 claude/codex）✓。测后进程/端口/临时文件全部清理。
