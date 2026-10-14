# Claude Code CLI 快捷键与斜杠命令全集调研

> 调研日期：2026-10-14。版本基准：本地 `claude --version` = 2.1.286，官方文档引用至 v2.1.288。
> 来源：官方文档 [interactive-mode](https://code.claude.com/docs/en/interactive-mode) / [commands](https://code.claude.com/docs/en/commands) / [keybindings](https://code.claude.com/docs/en/keybindings) / [skills](https://code.claude.com/docs/en/skills) / [terminal-config](https://code.claude.com/docs/en/terminal-config)。
> 用途：为 `shared/src/defaults.ts` 的 `claude-code` 快捷键组与 `claude` 命令组提供数据来源。

## 一、键盘快捷键

### 1. 全局控制

| 快捷键 | 作用 | 备注 |
| :- | :- | :- |
| `Ctrl+C` | 中断运行中操作；空闲时第一次清空输入框，第二次退出 | 保留键不可重绑 |
| `Ctrl+D` | 退出会话（800ms 内两次确认）；有文字时删除光标后字符 | 保留键 |
| `Esc` | 中断 Claude / 关闭对话框 / 权限提示上等于拒绝 | |
| `Esc Esc` | 有文字：清空并存草稿；空输入框：打开 rewind 检查点菜单 | |
| `Ctrl+L` | 强制终端重绘 | action `chat:clearInput` |
| `Ctrl+O` | 切换 transcript viewer | viewer 内有独立键位（见 §6） |
| `Ctrl+R` | 反向搜索历史输入 | 全屏渲染下为搜索对话框，`Ctrl+S` 切换范围 |
| `Ctrl+V`（WSL 亦 `Alt+V`） | 粘贴剪贴板图片 → `[Image #N]` | |
| `Ctrl+B` | 运行中的命令/agent 转后台 | tmux 用户需按两次；亦有 `Ctrl+X Ctrl+B` |
| `Ctrl+T` | 切换 todo 任务清单显示 | |
| `Ctrl+S` | 暂存/恢复输入框草稿（含光标、粘贴、输入模式） | action `chat:stash` |
| `Ctrl+Z` | 挂起进程（Unix） | |
| `Ctrl+G` / `Ctrl+X Ctrl+E` | 在外部编辑器编辑 prompt | |
| `Ctrl+X Ctrl+K` | 停止全部后台 subagent | 3 秒内两次确认 |
| `Ctrl+Enter` / `Ctrl+X Ctrl+S` | 立即发出排队消息 | ≥2.1.275 |
| `Ctrl+X Enter` | 提交消息但标记为排队 | ≥2.1.247 |
| `Shift+Tab` | 循环权限模式 default→acceptEdits→plan→(bypass)→auto | Windows 无 VT 时回退 `Alt+M` |
| `Option/Alt+P` | 模型选择器（不清空输入框） | macOS 需 Option as Meta |
| `Option/Alt+T` | 切换扩展思考 | macOS 无需 Option as Meta |
| `Option/Alt+O` | 切换 fast mode | |
| `Up/Down` / `Ctrl+P/N` | 输入框内移动光标，顶/底行后再按翻历史 | |
| `Tab` | 接受补全建议；权限提示上附加备注 | |
| `←`（空输入框） | 进入 agent view（后台会话列表） | |

### 2. 文本编辑（readline 风格）

`Ctrl+A/E/K/U/W/Y`、`Alt+Y/B/F/D`、`Option+Delete` / `Ctrl+Backspace`（删前词）、`Ctrl+_`（撤销编辑）。
词级边界约定为 v2.1.261+ 默认行为，**不能**在 keybindings.json 重映射。

### 3. 多行输入

| 方式 | 备注 |
| :- | :- |
| `\` + `Enter` | 所有终端可用 |
| `Option+Enter` | macOS 需 Option as Meta |
| `Shift+Enter` | 需终端原生支持或 `/terminal-setup` |
| `Ctrl+J` | 任何终端免配置（action `chat:newline`） |

### 4. 快速前缀（输入首字符）

| 前缀 | 作用 | 备注 |
| :- | :- | :- |
| `/` | 命令/技能菜单 | |
| `!` | shell 模式：直接跑命令、输出进上下文 | Tab 补全；沙箱外执行 |
| `@` | 文件路径补全（@ 引用） | ≥2.1.232 还会建议其他活跃会话 |
| `:` | emoji 短代码 | ≥2.1.217 |
| `?`（空输入框） | 切换快捷键帮助面板 | |
| `#` | 旧版"追加 CLAUDE.md"前缀，**现行文档已不再列出** | 按 legacy 处理 |

### 5. 历史搜索（Ctrl+R 内）

`Tab`/`Esc` 接受继续编辑、`Enter` 接受并执行、`Ctrl+C` 取消还原、`Ctrl+S`（全屏）循环范围 本会话→本项目→全部。

### 6. Transcript viewer（Ctrl+O 内）

| 键 | 作用 | 备注 |
| :- | :- | :- |
| `{` / `}` | 跳上一条/下一条用户 prompt | 仅全屏渲染 |
| `Ctrl+E` | 切换显示全部内容（展开折叠） | 仅经典渲染 |
| `[` | 把会话写进终端原生 scrollback | 仅全屏 |
| `v` | 写临时文件用 `$VISUAL`/`$EDITOR` 打开 | 仅全屏 |
| `q` / `Ctrl+C` / `Esc` | 退出 | |

### 7. 全屏渲染滚动模式

滚轮逐行、`PageUp/PageDown` 半屏、`Ctrl+Home/End` 跳开头/最新、`Ctrl+Shift+C` 复制、`Shift+方向键` 扩展选区、`/scroll-speed` 调速。

### 8. Vim 模式（`/config` → Editor mode；`/vim` 命令已于 v2.1.92 移除）

`Esc`/`Ctrl+[` 进 NORMAL，`i/I/a/A/o/O` 进插入，`v/V` 进 VISUAL；NORMAL 导航 `hjkl w e b 0 $ ^ gg G f{c} /`；编辑 `x r dd D dw cc C yy p P u .` 等；文本对象 `iw aw i" a( a{` 等。vim 按键不能重映射。

### 9. 自定义快捷键

`/keybindings` 打开 `~/.claude/keybindings.json`，结构 `{"bindings":[{"context":"Chat","bindings":{"ctrl+e":"chat:externalEditor"}}]}`，`null` 解绑，支持和弦。27 个 context。保留键：`Ctrl+C/D/M/[`、`Ctrl+I/H`、`Caps Lock`。

## 二、斜杠命令全集（官方 All commands 表）

标注 [S] = 内置捆绑技能、[W] = 捆绑动态工作流。

### 1. 会话与上下文

| 命令 | 作用 |
| :- | :- |
| `/clear [name]` | 清空上下文开新会话（别名 /reset /new） |
| `/compact [instructions]` | 压缩上下文 |
| `/context [all]` | 可视化上下文占用 |
| `/autocompact [auto\|<tokens>]` | 设自动压缩窗口（≥2.1.221） |
| `/resume [session]` | 恢复会话（别名 /continue） |
| `/branch [name]` | 分叉会话并切入 |
| `/fork [prompt]` | 复制当前会话为后台会话（≥2.1.212） |
| `/subtask <task>` | 派出继承完整对话的 subagent（≥2.1.212） |
| `/rewind` | 回滚代码/对话到检查点（别名 /checkpoint /undo） |
| `/rename [name]` | 重命名当前会话 |
| `/export [filename]` | 导出会话纯文本 |
| `/copy [N]` | 复制第 N 新回复；`w` 写文件 |
| `/diff` | 查看 working tree 变更 |
| `/btw [question]` | 不进历史的旁问 |
| `/recap` | 生成本会话一行摘要 |
| `/goal [condition\|clear]` | 设跨回合目标 |
| `/background [prompt]` | 整会话转后台（别名 /bg） |
| `/tasks` | 查看/管理后台任务（别名 /bashes） |
| `/stop` | 停止已 attach 的后台会话 |
| `/exit` | 退出（别名 /quit） |
| `/teleport` | 云会话拉到本终端（/tp） |
| `/remote-control` | 允许 claude.ai 远程操控（/rc） |
| `/desktop` | 转到 Desktop 应用（/app，仅 macOS/x64 Win） |
| `/cd <path>` | 会话切工作目录（≥2.1.246） |
| `/add-dir <path>` | 添加可访问目录 |

### 2. 模型 / 性能 / 推理

| 命令 | 作用 |
| :- | :- |
| `/model [model]` | 切换模型并存默认 |
| `/effort [level\|auto\|status\|ultracode]` | 调推理力度（≥2.1.284 on/off） |
| `/fast [on\|off]` | 切 fast mode（≥2.1.205） |
| `/advisor [model\|off]` | 第二模型顾问（≥2.1.260） |

### 3. 配置 / 界面

| 命令 | 作用 |
| :- | :- |
| `/config [key=value]` | 设置界面（别名 /settings） |
| `/permissions` | 权限管理（别名 /allowed-tools） |
| `/theme` | 换主题 |
| `/statusline` | 配置状态栏 |
| `/output-style [style]` | 切换输出风格（≥2.1.269） |
| `/color [color]` | 设提示栏颜色（≥2.1.205） |
| `/terminal-setup` | 装 Shift+Enter 键位 |
| `/keybindings` | 打开 keybindings.json |
| `/tui [default\|fullscreen]` | 切渲染器 |
| `/focus` | 专注视图（全屏） |
| `/scroll-speed` | 滚轮速度（全屏） |
| `/sandbox` | 切换沙箱模式 |
| `/memory` | 编辑 CLAUDE.md / auto memory |
| `/status` | Status 标签（版本/模型/账号） |
| `/ide` | IDE 集成 |
| `/vim` | **已移除（v2.1.92）** |

### 4. 代码工作流

| 命令 | 作用 |
| :- | :- |
| `/init` | 生成项目 CLAUDE.md |
| `/plan [description]` | 直接进 plan mode |
| `/code-review [级别] [--fix]` | 审查 diff/PR（[S]，别名 /review） |
| `/security-review` | 安全审查 |
| `/simplify [target]` | 并行 agent 清理（[S]） |
| `/batch <instruction>` | 大改造并行 worktree 派 PR（[S]） |
| `/deep-research <question>` | 扇出调研报告（[W]） |
| `/loop [interval] [prompt]` | 循环跑 prompt（[S]，别名 /proactive） |
| `/run` | 启动 app 验证改动（[S]） |
| `/verify` | 构建+运行验证（[S]） |
| `/run-skill-generator` | 录制 run-* 技能（[S]） |
| `/fewer-permission-prompts` | 生成 allowlist（[S]） |
| `/update-config [request]` | 自然语言改 settings.json（[S]） |
| `/autofix-pr [prompt]` | 云会话盯 PR 自动修复 |
| `/pr-comments` | **已移除（v2.1.91）** |
| `/ultraplan` / `/ultrareview` | 前者已移除；后者云端深审 |

### 5. MCP / 扩展 / 集成

| 命令 | 作用 |
| :- | :- |
| `/mcp [reconnect\|enable\|disable]` | 管理 MCP 服务器与 OAuth |
| `/plugin [subcommand]` | 插件管理 |
| `/reload-plugins [--force]` | 热应用插件改动（≥2.1.260） |
| `/reload-skills` | 重扫技能目录 |
| `/install-github-app` | 装 GitHub App |
| `/install-slack-app` | 装 Slack 应用 |
| `/chrome` | 配置 Claude in Chrome |
| `/claude-in-chrome [task]` | [S] 操作浏览器执行任务 |
| `/import [codex\|gemini\|cursor]` | 从三方迁移配置（≥2.1.213） |
| `/remote-env` | 云会话默认环境 |
| `/web-setup` | gh 凭据连 GitHub |
| `/schedule [description]` | 云端定时任务（/routines） |
| `/workflows` | workflow 进度视图 |
| `/artifact-capabilities` / `/artifact-diagramming` / `/artifacts` | artifact 参考/图表/列表（[S]×2） |
| `/design [brief]` / `/design-sync` / `/design-login` / `/slides` | Design 画板/上传/授权/幻灯片（≥2.1.265） |

### 6. 账号 / 计划 / 用量

| 命令 | 作用 |
| :- | :- |
| `/login` / `/logout` | 登录 / 登出 |
| `/usage` | 成本与限额（别名 /cost /stats） |
| `/usage-credits` | 配置用量积分 |
| `/upgrade` | 打开升级页 |
| `/rate-limit-options` | 限额时选项菜单 |
| `/passes` | 赠送一周 |
| `/privacy-settings` | 隐私设置（Pro/Max） |
| `/mobile` | 移动 app 二维码（/ios /android） |

### 7. 帮助 / 诊断 / 杂项

| 命令 | 作用 |
| :- | :- |
| `/help` | 帮助 |
| `/doctor [prompt-audit]` | 体检修复（[S]，别名 /checkup） |
| `/bug [report]` | 报 bug（别名 /share） |
| `/feedback [report]` | 产品反馈 |
| `/debug [description]` | [S] 开调试日志排障 |
| `/release-notes` | 版本说明 |
| `/insights` | 使用分析 HTML 报告 |
| `/team-onboarding` | 团队上手指南 |
| `/powerup` | 功能课程 |
| `/heapdump` | JS 堆快照（隐藏命令，须全名） |
| `/skills` | 列出技能（t 排序、Space 切可见性） |
| `/skill-doctor` | 技能成本报告（≥2.1.252） |
| `/list-agents` | 可跨会话消息的 agent 列表（/peers，≥2.1.224） |
| `/agents` | v2.1.197 后只打印提示 |
| `/claude-api` / `/dataviz` / `/workflow-authoring` / `/plugin-authoring` | [S] 各类参考 |
| `/voice [hold\|tap\|off]` | 语音听写 |
| `/radio` | lo-fi 电台 |
| `/stickers` | 订购贴纸 |
| `/setup-bedrock` / `/setup-vertex` | 云配置向导（隐藏） |

### 8. 自定义斜杠命令（= 技能）

`.claude/commands/deploy.md` 或 `.claude/skills/deploy/SKILL.md`（项目/用户级 `~/.claude/`）→ `/deploy`。子目录变命名空间 `/frontend:component`。支持 `$ARGUMENTS`/`$N`、`allowed-tools`、`disable-model-invocation` 等 frontmatter。

## 三、注意点

1. 大量命令/快捷键有最低版本要求，收录时在 desc 标注。
2. 平台差异：macOS Option-as-MMeta（Alt+B/F/D/Y/P）、Windows 无 VT 时 Shift+Tab→Alt+M、WSL 图片粘贴 Ctrl+V/Alt+V。
3. 经典 vs 全屏渲染器（`/tui fullscreen`）下 Ctrl+R、transcript、diff、滚动键行为不同。
4. 部分命令按平台/套餐出现（/desktop、/passes 等），Bedrock/Vertex/Foundry 下 design/schedule 类不可用。
