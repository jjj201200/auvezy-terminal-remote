# auvezy-terminal-remote

> 局域网内通过手机 / 平板浏览器远程控制 PC 上的任意终端程序（zsh / bash / claude / 任何 CLI）。
>
> 一行命令 `atr <program>`，多终端多实例自动出现在浏览器顶栏 tab 切换。

> **License: [PolyForm Noncommercial 1.0.0](./LICENSE)** —
> 个人 / 学习 / 非营利组织可自由使用、修改、再分发；商业用途需另外获得授权。

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
npm install -g auvezy-terminal-remote   # 必须 -g
```

> ⚠️ npm 页面右上角自动显示的 `npm i auvezy-terminal-remote` **缺 `-g`**——
> 这是 CLI 工具，没有 `-g` 装完不会暴露 `atr` 命令。请按上面那行装。

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
git clone https://gitee.com/drowsyflesh/auvezy-terminal-remote.git
cd auvezy-terminal-remote
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


第一档（移动端必加，工作量小，明显改善体验）

1. Local Echo 本地预回显（Mosh/Blink/code-server）
移动端 4G/弱网下输入延迟杀手。在 xterm 里用预测插件让按键立刻显示，PTY 回包覆盖。投入低收益巨大。
2. 多行粘贴警告 + bracketed paste（VS Code、Tabby）
移动端从微信/邮件粘贴 5 行命令，目前直接发，危险。检测多行 → 弹确认。
3. Shell Integration 子集（OSC 633/133）
  - command decorations（绿/红圆点）
  - Run Recent Command 跨会话 fuzzy 历史 quick pick
  - 这两个对手机用户极友好（手机打字慢 → 跨会话历史搜索是核心需求）
4. Auto Reply（自动应答）（VS Code）
匹配 prompt 自动回 y/N。手机用户输 [y/N] 太麻烦。
5. Process Revive（VS Code 终端复活）
你已有 instances.json，把 scrollback 序列化进去，重启后 webapp 能看到上次的内容。LAN-only 路线下唯一难点是序列化 size，扩 5MB 即可。

第二档（移动端体验加分）

6. SmartKeys 长按出菜单（Blink）
屏幕键盘扩展行，长按 Tab 出 Shift+Tab；长按 Esc 出 ^[; 长按 Ctrl 黏住直到下个键。我们已有 Toolbar 快捷键面板，差「长按弹菜单」+「修饰键黏滞」。
7. 拇指拖光标条（Termius：长按空格当 trackpad）
终端区底部留个 8px 透明条，拖动 = 发方向键序列。手机精确移光标的最优解。
8. OSC 8 hyperlinks + word-link / file-link（VS Code）
xterm.js 原生 LinkProvider，加几行就能让 src/foo.ts:42 变可点击。
9. 多 chord 快捷键 / 修饰键黏滞（Tabby、Blink）
手机虚拟修饰键 + Cmd-K Cmd-S 这类两步组合，比堆按钮节省屏幕。
10. Quick Fixes（VS Code）
扫描输出推荐修复。fatal: ... --set-upstream 一键应用。投入大但很出彩。

第三档（写权限 / 安全 / 协作）

11. Writable / Read-only 分离（ttyd -W、gotty -w）
多设备同时连入同一实例时，可设其他人只读。投入很小（WS 握手时区分）。
12. Broadcast Input 多终端同步输入（Termius）
多个 webapp 同时连一个实例时，把同一输入广播给所有 PTY。我们多实例架构很容易加。
13. TLS 自签证书（ttyd -S、gotty -t）
LAN 内 https 让 Web Push API 在更多浏览器上能用（目前 LAN HTTP 下 Push API 受限）。
14. OAuth / 客户端证书鉴权（ttyd 客户端证书）
我们当前 token，可加客户端证书做硬鉴权。优先级低，token 已经够。

第四档（明确不抄）

- ❌ 插件系统（Tabby）：LAN-only 单 binary 没必要
- ❌ 云端 Settings Sync（VS Code）：跟 LAN-only 红线冲突
- ❌ Sixel/iTerm 图像协议：移动端价值低，xterm.js 不原生
- ❌ asciinema 公网分享：跟 LAN-only 冲突；要做就只做本地 .cast 导出
- ❌ SFTP/SCP 文件管理（Termius/Wetty）：偏离"远程 PTY 控制"定位
- ❌ 端到端加密 Vault：用户家庭 LAN 不需要

---
我们独特但其他都没做的"痛点"

- Tailscale / VPN 二维码标注：你们已经做了 LAN+Tailscale 双码，这个是 LAN-only 路线非常贴心的细节
- Webapp 弹通知 + iOS LocalNotification fallback：iOS PWA 推送限制下，这个 fallback 思路别家完全没考虑过