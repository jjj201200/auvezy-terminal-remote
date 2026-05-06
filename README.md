# auvezy-terminal-remote

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

## 快速开始

### 全局安装（npm 用户）

```bash
npm install -g auvezy-terminal-remote
```

之后任意终端：

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

### 源码方式（开发或自构建）

```bash
git clone https://gitee.com/drowsyflesh/open-terminal-remote.git
cd open-terminal-remote
bash install.sh           # 检查 Node 20+/pnpm 9+/编译依赖 → 装包 → 构建
node backend/dist/cli.js  # 等价于 atr
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

启动时自动读 `~/.auvezy/terminal-remote/config.json`，结构：

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
  --command <cmd>     PTY 启动命令（默认 'claude'）
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
| `OCR_ANSI_FILTER` | 是否过滤 alt-screen 输出（默认 `false`）。设 `true` 让 vim/htop 退出后重连回放更干净；但全程 alt-screen TUI（claude/tmux/...）仍受内置黑名单保护，自动豁免不会空白 |
| `OCR_ANSI_FILTER_TUI_NAMES` | 追加自家 alt-screen TUI 黑名单（逗号分隔），例如 `"lazygit,k9s,gh-dash"` |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | 注入 VAPID（高优先级，跳过文件）|
| `PORT`        | 同 `--port` |
| `STRICT_PORT` | 同 `--strict-port`（设 `true` 启用严格模式）|
| `OCR_SPAWN_TIMEOUT` | 同 `--spawn-timeout`（秒；0 = 无超时）|
| `AUTH_TOKEN`  | 指定 token（默认自动生成）|
| `LOG_LEVEL`   | pino 级别（默认 info）|

> 旧名 `CLAUDE_COMMAND` / `CLAUDE_ARGS` / `CLAUDE_CWD` 仍兼容（启动时会 warn 一次）。
> 改名是为了说清楚：这个项目不绑定 Claude，能跑任何 PTY 程序。

## 安装为 PWA（手机推荐）

webapp 自带 manifest，可"添加到主屏幕"获得近原生 app 体验：

- **Android Chrome**：右上角 ⋮ → "安装应用"（或地址栏会自动弹"安装"提示）
- **iOS Safari**：分享按钮 → "添加到主屏幕"

启动后无浏览器 UI（无地址栏、无底部导航），独立任务卡片，状态栏与 app 同色。

> **Web Push 限制**：浏览器规定 Push 必须在 secure context（HTTPS / localhost）下，
> LAN HTTP（http://192.168.x.x）无法订阅推送。设置面板会显示"需 HTTPS"。
> 解决方案：用 Tailscale / Cloudflare Tunnel 给后端套一层 HTTPS，或自签证书部署。

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


看了下当前状态，几个值得做的方向（按价值/成本排序）：

偏长期

8. 会话录制 / 回放 — 把 PTY output 流存成 asciinema 格式，离线回看。
9. 多窗格 / tmux 风格分屏 — 一个实例内开多个 PTY，前端做拆分布局。

我个人会优先做 1+2（先 commit + 发版），然后挑 4（断线重连）+ 6（复制选区）——这两个是日常用最容易踩到的痛点。

要我先开始哪个？