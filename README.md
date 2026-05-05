# @drowsyflesh/open-terminal-remote

> 局域网内通过手机 / 平板浏览器远程控制 PC 上的任意终端程序（zsh / bash / claude / 任何 CLI）。
>
> 一行命令 `otr <program>`，多终端多实例自动出现在浏览器顶栏 tab 切换。

## 这是什么

你坐在沙发上拿着手机，PC 上某个 CLI（Claude Code / 部署脚本 / 调试会话…）正在跑一个长任务。你希望：

- 实时看到终端输出（包括 ANSI 颜色）
- 输入下一条指令、按方向键
- Claude 触发审批 hook 时，手机锁屏弹通知
- 不开公网、不依赖云

这正是这个项目要做的。把 PTY 输出经 WebSocket 桥到 webapp，
把 webapp 输入桥回 PTY。仅绑 LAN IP，用 token + 本地 cookie 鉴权。

## 快速开始

### 全局安装（npm 用户）

```bash
npm install -g @drowsyflesh/open-terminal-remote
```

之后任意终端：

```bash
otr                       # 跑当前 $SHELL（zsh / bash 自动检测）
otr claude                # 跑 claude
otr zsh                   # 跑 zsh
otr claude --resume foo   # 透传任意参数给子进程
```

启动后扫终端打印的二维码 → webapp 自动登录（token 在 `~/.claude-remote/config.json`）。

**多实例**：在不同终端多次 `otr <prog>`，每次会自动占一个新端口（3000、3001、3002…），
浏览器顶栏会自动出现新 tab，点击即可切换。

```bash
otr list                  # 列出本机所有实例
otr stop                  # 停止本机所有实例
otr attach <url>          # 命令行接管已有实例
```

### 源码方式（开发或自构建）

```bash
git clone https://gitee.com/drowsyflesh/open-terminal-remote.git
cd open-terminal-remote
bash install.sh           # 检查 Node 20+/pnpm 9+/编译依赖 → 装包 → 构建
node backend/dist/cli.js  # 等价于 otr
```

## 功能矩阵

| 功能 | 实现 |
|---|---|
| PTY 桥接 | node-pty + xterm.js 5 |
| 鉴权 | timingSafeEqual token + Session Cookie（端口绑定）|
| 多实例 | port-finder 自动递增 + cookie name 后缀隔离 |
| 重连回放 | OutputBuffer + history_sync（默认过滤 alt-screen）|
| 审批通知 | Web Push（VAPID 三优先级）+ iOS Safari LocalNotification fallback |
| IP 漂移检测 | 30s 轮询 + 稳定阈值 + ip_changed 广播 |
| 配置改写 | webapp Settings 弹窗 → /api/config |
| attach 子命令 | 主从仲裁（webapp > attach > PC）|

## 配置

启动时自动读 `~/.claude-remote/config.json`，结构：

```json
{
  "token": "<64位 hex 自动生成>",
  "shortcuts": [
    { "label": "ESC", "data": "" },
    { "label": "↑",   "data": "[A" }
  ],
  "command": null,
  "args": null,
  "rateLimitPerMinute": 10,
  "sessionTtlMs": 86400000
}
```

VAPID 也放同目录：`vapid.json`（0o600，自动生成或读环境变量
`VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY`）。

订阅信息在 `push-subscriptions.json`，多实例注册表在
`instances/<port>.json`。

## 启动选项

```
ocr [子命令] [选项]

子命令：
  start          启动 backend（默认）
  attach         attach 到运行中的实例（命令行接管）
  list           列出本机所有运行中实例
  stop           停止本机所有实例

选项：
  --port <n>          端口（默认 3000，多实例自动递增）
  --name <s>          实例名（用于 webapp 显示）
  --no-terminal       不打印二维码（CI / 守护进程友好）
  --command <cmd>     PTY 启动命令（默认 'claude'）
  --args <json>       命令参数（JSON 数组字符串）
```

环境变量：

| 变量 | 用途 |
|---|---|
| `OCR_COMMAND` | 子进程命令（默认 `$SHELL`，没有则 `/bin/sh`；显式设为 `claude` 跑 Claude）|
| `OCR_ARGS`    | 命令参数（JSON 数组字符串，如 `'["-c","tail -f /dev/null"]'`）|
| `OCR_CWD`     | 子进程工作目录（默认 `process.cwd()`）|
| `OCR_ANSI_FILTER` | 是否过滤 alt-screen 输出（默认 `false`）。设 `true` 让 vim/htop 退出后重连回放更干净；但全程 alt-screen TUI（claude/tmux/...）仍受内置黑名单保护，自动豁免不会空白 |
| `OCR_ANSI_FILTER_TUI_NAMES` | 追加自家 alt-screen TUI 黑名单（逗号分隔），例如 `"lazygit,k9s,gh-dash"` |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | 注入 VAPID（高优先级，跳过文件）|
| `PORT`        | 同 `--port` |
| `AUTH_TOKEN`  | 指定 token（默认自动生成）|
| `LOG_LEVEL`   | pino 级别（默认 info）|

> 旧名 `CLAUDE_COMMAND` / `CLAUDE_ARGS` / `CLAUDE_CWD` 仍兼容（启动时会 warn 一次）。
> 改名是为了说清楚：这个项目不绑定 Claude，能跑任何 PTY 程序。

## 在 WSL 中跑、Windows 浏览器访问

WSL2 的两种网络模式行为不同：

- **mirrored 模式**（Win11 22H2+ 默认）：WSL 直接拿 Windows LAN IP（如 `192.168.x.x`），
  Windows 浏览器可以直接用 banner 上的 IP 访问，无需任何额外配置
- **NAT 模式**（默认）：WSL 在 `172.x.x.x` 私网，Windows 浏览器无法直连。
  backend 启动时会自动检测并在 banner 末尾打印 PowerShell 配置命令

**一键自动配置**（管理员 PowerShell）：

```powershell
# 转发常用端口范围（默认 3000-3010）
.\scripts\wsl-port-forward.ps1

# 仅转发指定端口
.\scripts\wsl-port-forward.ps1 -Ports 3000,3001

# 注册到登录时自动重配（WSL 重启后 IP 变了无需手动跑）
.\scripts\wsl-port-forward.ps1 -Persist

# 清理
.\scripts\wsl-port-forward.ps1 -Reset
```

## 架构 / 决策

- 设计文档：[`docs/plans/open-claude-remote-clone/design.md`](./docs/plans/open-claude-remote-clone/design.md)
- 模块图与数据流：[`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md)
- 关键决策（ADR）：[`docs/plans/open-claude-remote-clone/adrs/`](./docs/plans/open-claude-remote-clone/adrs/)

## 开发

```bash
pnpm install
pnpm dev          # backend (tsx watch) + frontend (vite) 并行
pnpm test         # shared + backend + frontend 单测
pnpm typecheck
pnpm build        # 交付构件（含 frontend 拷入 backend/frontend-dist）
```

## 许可

MIT
