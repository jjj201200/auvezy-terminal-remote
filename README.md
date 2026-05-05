# open-claude-remote-clone

> 局域网内通过手机 / 平板浏览器远程控制 PC 上的 Claude Code CLI。
>
> Clean-room 复刻自 `open-claude-remote@0.1.1`：协议字段保持兼容，
> 实现完全独立。

## 这是什么

你坐在沙发上拿着手机，PC 上的 Claude 正在跑一个长任务。你希望：

- 实时看到 Claude 的输出（包括 ANSI 颜色）
- 输入下一条指令、按方向键
- Claude 触发审批 hook 时，手机锁屏弹通知
- 不开公网、不依赖云

这正是这个项目要做的。把 PTY 输出经 WebSocket 桥到 webapp，
把 webapp 输入桥回 PTY。仅绑 LAN IP，用 token + 本地 cookie 鉴权。

## 快速开始

```bash
# 一键安装（检查 Node 20+/pnpm 9+/编译依赖 → 装包 → 构建）
bash install.sh

# 启动（默认 0.0.0.0:3000，二维码会打到终端）
pnpm start

# 启动多实例
pnpm start -- --port 3001
pnpm start -- --port 3002 --name worker

# 停止本机所有实例
pnpm stop

# attach 到某个实例的 stdin/stdout（命令行接管）
node backend/dist/cli.js attach
```

启动后扫描终端二维码 → webapp 自动登录（首启 token 写在 ~/.claude-remote/config.json）。

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
| `OCR_COMMAND` | 子进程命令（默认 `claude`，可换 `bash` 等任意 PTY 程序）|
| `OCR_ARGS`    | 命令参数（JSON 数组字符串，如 `'["-c","tail -f /dev/null"]'`）|
| `OCR_CWD`     | 子进程工作目录（默认 `process.cwd()`）|
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | 注入 VAPID（高优先级，跳过文件）|
| `PORT`        | 同 `--port` |
| `AUTH_TOKEN`  | 指定 token（默认自动生成）|
| `LOG_LEVEL`   | pino 级别（默认 info）|

> 旧名 `CLAUDE_COMMAND` / `CLAUDE_ARGS` / `CLAUDE_CWD` 仍兼容（启动时会 warn 一次）。
> 改名是为了说清楚：这个项目不绑定 Claude，能跑任何 PTY 程序。

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
