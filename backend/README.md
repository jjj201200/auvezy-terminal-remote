# @auvezy/terminal-remote

> 局域网内通过手机 / 平板浏览器远程控制 PC 上的任意终端程序（zsh / bash / claude / 任何 CLI）。
>
> 一行命令 `atr <program>`，多终端多实例自动出现在浏览器顶栏 tab 切换。

## 这是什么

你坐在沙发上拿着手机，PC 上某个 CLI（Claude Code / 部署脚本 / 调试会话…）正在跑一个长任务。你希望：

- 实时看到终端输出（包括 ANSI 颜色）
- 输入下一条指令、按方向键
- Claude 触发审批 hook 时，手机锁屏弹通知
- 不开公网、不依赖云

这正是这个项目要做的。把 PTY 输出经 WebSocket 桥到 webapp，
把 webapp 输入桥回 PTY。仅绑 LAN IP，用 token + 本地 cookie 鉴权。

## 安装

```bash
npm install -g @auvezy/terminal-remote
```

## 使用

```bash
atr                       # 跑当前 $SHELL（zsh / bash 自动检测）
atr claude                # 跑 claude
atr zsh                   # 跑 zsh
atr claude --resume foo   # 透传任意参数给子进程
```

启动后扫终端打印的二维码 → webapp 自动登录（token 在 `~/.auvezy/terminal-remote/config.json`）。

**多实例**：在不同终端多次 `atr <prog>`，每次会自动占一个新端口（3000、3001、3002…），
浏览器顶栏会自动出现新 tab，点击即可切换。

```bash
atr list                  # 列出本机所有实例
atr stop                  # 停止本机所有实例
atr attach <url>          # 命令行接管已有实例
```

## 启动选项

```
atr [子命令] [选项]

子命令：
  start          启动 backend（默认）
  attach         attach 到运行中的实例（命令行接管）
  list           列出本机所有运行中实例
  stop           停止本机所有实例

选项：
  -p, --port <n>      端口（默认 3000，多实例自动递增；除非 -S）
  -S, --strict-port   严格端口模式：被占即报错退出，不自适应
  --spawn-timeout <s> PTY spawn 兜底秒数（默认 30；0=不超时；
                      首个浏览器连入 / 按 Enter / 超时三选一触发）
  --wait-confirm      强制必须按 Enter 才 spawn（覆盖浏览器/超时触发）
  --name <s>          实例名（用于 webapp 显示）
  --no-terminal       不打印二维码（CI / 守护进程友好）
  --command <cmd>     PTY 启动命令（默认当前 $SHELL）
  --args <json>       命令参数（JSON 数组字符串）
  -h, --help          显示帮助
  -v, --version       显示版本号
```

环境变量：

| 变量 | 用途 |
|---|---|
| `OCR_COMMAND` | 子进程命令（默认 `$SHELL`，没有则 `/bin/sh`；显式设为 `claude` 跑 Claude）|
| `OCR_ARGS`    | 命令参数（JSON 数组字符串，如 `'["-c","tail -f /dev/null"]'`）|
| `OCR_CWD`     | 子进程工作目录（默认 `process.cwd()`）|
| `OCR_ANSI_FILTER` | 是否过滤 alt-screen 输出（默认 `false`）。设 `true` 让 vim/htop 退出后重连回放更干净；但全程 alt-screen TUI（claude/tmux/...）仍受内置黑名单保护 |
| `OCR_ANSI_FILTER_TUI_NAMES` | 追加自家 alt-screen TUI 黑名单（逗号分隔），例如 `"lazygit,k9s,gh-dash"` |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | 注入 VAPID（高优先级，跳过文件）|
| `PORT`        | 同 `--port` |
| `STRICT_PORT` | 同 `--strict-port`（设 `true` 启用严格模式）|
| `OCR_SPAWN_TIMEOUT` | 同 `--spawn-timeout`（秒；0 = 无超时）|
| `AUTH_TOKEN`  | 指定 token（默认自动生成）|
| `LOG_LEVEL`   | pino 级别（默认 info）|

## 配置

启动时自动读 `~/.auvezy/terminal-remote/config.json`（首次启动自动生成）。
VAPID 在 `~/.auvezy/terminal-remote/vapid.json`，多实例注册表在
`~/.auvezy/terminal-remote/instances/<port>.json`。

## 在 WSL 中跑、Windows 浏览器访问

WSL2 的两种网络模式行为不同：

- **mirrored 模式**（Win11 22H2+ 默认）：WSL 直接拿 Windows LAN IP（如 `192.168.x.x`），
  Windows 浏览器可以直接用 banner 上的 IP 访问，无需任何额外配置
- **NAT 模式**（默认）：WSL 在 `172.x.x.x` 私网，Windows 浏览器无法直连。
  backend 启动时会自动检测并在 banner 末尾打印 PowerShell 配置命令

## 系统要求

- Node.js ≥ 20

## 许可

专有软件，保留所有权利。详见 LICENSE。
