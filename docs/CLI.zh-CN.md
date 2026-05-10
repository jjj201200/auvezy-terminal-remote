# CLI 参考

[English](./CLI.md) · [简体中文](./CLI.zh-CN.md)

## 语法

```
atr [atr 自身 flag...] [program] [program 参数...]    # 派生 PTY（默认）
atr <子命令> [参数]                                    # 管 broker / 实例
```

**严格参数顺序**：atr 自己的 flag 必须放在 `[program]` **之前**。一旦遇到
program 名，之后所有 token 原样透传给子进程，atr 不再解析（无 flag 别名歧义）。

示例：

| 形式 | 含义 |
|---|---|
| `atr` | 跑默认 `$SHELL` |
| `atr claude` | 跑 `claude` |
| `atr claude --resume foo` | 额外参数透传给 `claude` |
| `atr -p 3010 claude` | broker 端口 = 3010，再跑 `claude` |
| `atr -p 3010 claude --port 9` | `-p 3010` → atr；`--port 9` → claude（透传） |
| `atr -- --weird` | `--` 强制分隔；默认 shell 跑 `--weird` |

## 子命令

| 子命令 | 说明 |
|---|---|
| `start [--port n] [--host ip]` | 前台启动 broker（Ctrl+C 退） |
| `stop` | 停 broker（SIGTERM → 5s 优雅期 → SIGKILL） |
| `status` | 一屏看清：进程、token、入口 URL、实例 |
| `list` | 列当前所有活实例 |
| `logs` | tail 当天 broker 日志（`~/.atr/broker-YYYY-MM-DD.log`） |
| `install` | 注册开机自启（systemd / launchd） |
| `uninstall` | 卸载开机自启（带二次确认） |
| `attach <url>` | 命令行客户端连入某实例（第二个终端共享同一 PTY） |
| `kill <pattern \| all>` | 杀实例（按 name/cwd/host:port 子串匹配）；`all` 杀全部（带确认） |
| `completion <zsh\|bash\|fish>` | 输出对应 shell 的补全脚本到 stdout |

**保留词**：上面这些子命令在位置 0 一律识别为 subcommand。要跑同名 PATH
二进制（比如 PATH 上有个叫 `start` 的工具）：`atr ./start` 或 `atr -- start`。
在交互终端下，atr 会 prompt 让你选 subcommand 还是 PATH binary。

## 启动 flag（用于 `atr [program]`）

| Flag | 说明 |
|---|---|
| `-p, --port <n>` | broker 端口（默认 3000）。broker 已在别的端口跑时 atr 拒绝启动 —— 用 `atr stop` 后再 `atr -p <n>` 切换。worker 端口由 OS 自动分配，用户不可控。 |
| `--host <ip>` | broker 监听 host（默认 `0.0.0.0`；worker 永远 `127.0.0.1`） |
| `-S, --strict-port` | 严格端口模式：preferred 被占即报错退出，不自动递增 |
| `--spawn-timeout <s>` | PTY spawn 兜底秒数（默认 30；0 = 无超时）。与 `--wait-confirm` 互斥 |
| `--token <hex>` | 指定固定 token（默认从 `~/.atrrc` 读 / 自动生成） |
| `--workdir <path>` | 子进程工作目录（默认：当前目录） |
| `--instance-name <s>` | 实例显示名（默认：cwd 末段） |
| `--config <path>` | config 文件路径（默认：`~/.atrrc`） |
| `--max-buffer-lines` | 输出缓冲行数上限（默认 10000） |
| `--session-ttl <ms>` | session TTL（毫秒，默认 24h） |
| `--auth-rate-limit <n>` | 单 IP 每分钟登录尝试上限（默认 20） |
| `--log-dir <path>` | 覆盖日志目录 |
| `--workdir-allow <patterns>` | cwd 白名单（picomatch glob，逗号分隔）。设了就要求新实例 cwd 至少匹配一条 |
| `--workdir-deny <patterns>` | cwd 黑名单（picomatch glob，逗号分隔）。命中即拒绝。默认包含 `/etc/**`、`/root/**` 等敏感路径；传 `""` 清空；CLI 覆盖 `~/.atrrc` |
| `--no-terminal` | 不在本进程 stdout 回显 PTY 输出 |
| `--no-color` | 关闭彩色输出 |
| `--no-open` | 不自动打开浏览器 |
| `--wait-confirm` | 启动后等用户按 Enter 才 spawn PTY 子进程（默认：立即 spawn） |
| `-h, --help` | 显示帮助 |
| `-v, --version` | 显示版本号 |
| `--` | 显式分隔；之后所有 token 透传给 program |

## 环境变量

| 变量 | 用途 |
|---|---|
| `ATR_BROKER_PORT` | 等价于 broker 的 `--port`（systemd unit / launchd plist 用这个传） |
| `ATR_BROKER_HOST` | 等价于 broker 的 `--host`（默认 `0.0.0.0`） |
| `ATR_DEBUG_SPAWN` | 设 `1` 把 broker fork 日志落到 `/tmp/atr-broker-*.log` |
| `NO_COLOR` | 任意非空值禁用彩色输出（https://no-color.org/） |
| `FORCE_COLOR` | 任意非空值强制保留彩色（即使 stdout 不是 TTY） |
| `LOG_LEVEL` | pino 级别（默认 `info`） |

## 文件位置

| 路径 | 内容 |
|---|---|
| `~/.atrrc` | 主配置：token、用户偏好、快捷键、命令片段 |
| `~/.atr/instances.json` | 当前活实例注册表（broker 与 worker 共享） |
| `~/.atr/broker.json` | broker 进程状态（pid / port / 启动时间） |
| `~/.atr/broker-YYYY-MM-DD.log` | broker 进程日志（按天切，保留 7 天） |
| `~/.atr/sessions/` | 共享 session 文件（cookie 认证） |
| `~/.atr/vapid-keys.json` | Web Push VAPID 密钥 |
| `~/.atr/push-subscriptions.json` | 已订阅的推送终端 |

## 多实例模型

broker 在 `0.0.0.0:3000` 跑一份（首次 `atr <program>` 时 auto-fork，或显式
`atr start`）。每次 `atr <program>` fork 一个 worker，仅监听 `127.0.0.1`
高位端口；broker 反代 `/i/<id>/api/*` 和 `/i/<id>/ws` 到对应 worker。
浏览器永远访问 broker；`/i/<id>/` 区分某个实例。

切换 broker 端口：`atr stop` → `atr -p <new>`（之后任何 `atr <program>`
会用新端口 auto-fork）。

## Shell 补全

生成补全脚本，按 shell 直接 source 或 append 到 rc 文件：

```bash
# zsh
atr completion zsh >> ~/.zshrc

# bash
atr completion bash >> ~/.bashrc

# fish
atr completion fish > ~/.config/fish/completions/atr.fish
```

提供 subcommand 和 flag 补全。`atr kill <Tab>` 提示 `all`，
`atr completion <Tab>` 提示 `zsh / bash / fish`。
