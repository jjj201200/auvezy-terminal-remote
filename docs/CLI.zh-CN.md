# CLI 参考

[English](./CLI.md) · [简体中文](./CLI.zh-CN.md)

## 语法

```
atr [atr 自身 flag...] [program] [program 参数...]
atr <子命令> [参数]
```

`atr` 自己的 flag（`-p / --port`、`--name`、`--no-terminal` 等）无论写在哪个位置都会被 atr 自己吃掉；
program 后面 atr 不认识的参数则透传给子进程。如果你想强行让 atr 停止解析、把后续参数全部交给子进程，加 `--` 显式分隔即可。

## 子命令

与 `[program]` 互斥：

| 子命令 | 说明 |
|---|---|
| `start` | 启动 backend（默认 —— 不显式给子命令时即此项） |
| `attach <url>` | attach 到运行中的实例（命令行接管） |
| `list` | 列出本机所有运行中实例 |
| `stop [pattern]` | 停止本机所有实例（可选名字 pattern） |

## 示例

```bash
atr                            # 跑当前 $SHELL（zsh / bash 自动检测）
atr claude                     # 跑 claude
atr zsh                        # 跑 zsh
atr claude --resume foo        # 未识别的参数自动透传给 claude
atr -p 3001 --name api claude  # atr 自身 flag + program + program 参数可共存
atr claude -- --port 8080      # program 自己的 flag 与 atr 同名时用 `--` 显式分隔
                               # （这里 --port 会被传给 claude，而非 atr）
```

## 选项

| Flag | 说明 |
|---|---|
| `-p, --port <n>` | 端口（默认 3000，多实例自动递增；除非 `-S`） |
| `-S, --strict-port` | 严格端口模式：被占即报错退出，不自适应 |
| `--spawn-timeout <s>` | PTY spawn 兜底秒数（默认 30；0 = 不超时；首个浏览器连入 / 按 Enter / 超时三选一触发） |
| `--wait-confirm` | 强制必须按 Enter 才 spawn（覆盖浏览器 / 超时触发） |
| `--name <s>` | 实例名（用于 webapp 显示） |
| `--no-terminal` | 不打印二维码（CI / 守护进程友好） |
| `--command <cmd>` | PTY 启动命令（默认 `claude`） |
| `--args <json>` | 命令参数（JSON 数组字符串） |
| `--workdir <path>` | 子进程工作目录（默认 `process.cwd()`） |
| `--token <s>` | 指定 token（默认自动生成） |
| `-h, --help` | 显示帮助 |
| `-v, --version` | 显示版本号 |

## 环境变量

| 变量 | 用途 |
|---|---|
| `OCR_COMMAND` | 子进程命令（默认 `$SHELL`，没有则 `/bin/sh`；显式设为 `claude` 跑 Claude） |
| `OCR_ARGS` | 命令参数（JSON 数组字符串，如 `'["-c","tail -f /dev/null"]'`） |
| `OCR_CWD` | 子进程工作目录（默认 `process.cwd()`） |
| `OCR_ANSI_FILTER` | 是否过滤 alt-screen 输出（默认 `false`）。设 `true` 让 vim / htop 退出后重连回放更干净；但全程 alt-screen TUI（claude / tmux / ...）仍受内置黑名单保护，自动豁免不会空白 |
| `OCR_ANSI_FILTER_TUI_NAMES` | 追加自家 alt-screen TUI 黑名单（逗号分隔），例如 `"lazygit,k9s,gh-dash"` |
| `OCR_CORS_ALLOW` | 扩展 CORS allow list（逗号分隔的 origin 列表） |
| `OCR_SPAWN_TIMEOUT` | 同 `--spawn-timeout`（秒；0 = 无超时） |
| `PORT` | 同 `--port` |
| `STRICT_PORT` | 同 `--strict-port`（设 `true` 启用严格模式） |
| `AUTH_TOKEN` | 指定 token（默认自动生成） |
| `LOG_LEVEL` | pino 级别（默认 `info`） |

## 配置文件

启动时自动读 `~/.auvezy/terminal-remote/config.json`：

```json
{
  "token": "<64位 hex 自动生成>",
  "shortcuts": [
    { "label": "ESC", "data": "" },
    { "label": "↑",   "data": "[A" }
  ],
  "command": null,
  "args": null,
  "rateLimitPerMinute": 10,
  "sessionTtlMs": 86400000
}
```

多实例注册表在同目录的 `instances/<port>.json`。
