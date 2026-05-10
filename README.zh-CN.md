<div align="center">

<img src="./frontend/public/icons/atr-icon.svg" alt="auvezy-terminal-remote logo" width="96" height="96">

# auvezy-terminal-remote

[![npm](https://img.shields.io/npm/v/auvezy-terminal-remote?style=flat-square&color=b6f09c&labelColor=0a0c0f)](https://www.npmjs.com/package/auvezy-terminal-remote)
[![license](https://img.shields.io/badge/license-PolyForm--NC--1.0.0-b6f09c?style=flat-square&labelColor=0a0c0f)](./LICENSE)
[![node](https://img.shields.io/node/v/auvezy-terminal-remote?style=flat-square&color=b6f09c&labelColor=0a0c0f)](https://nodejs.org)
[![stars](https://img.shields.io/github/stars/jjj201200/auvezy-terminal-remote?style=flat-square&color=b6f09c&labelColor=0a0c0f)](https://github.com/jjj201200/auvezy-terminal-remote)

[English](./README.md) · **简体中文**

局域网内通过手机 / 平板浏览器远程控制 PC 上的任意终端程序。
开机起一次 broker，浏览器打开就能登录、创建实例、跑 Claude / shell / 任何 TUI。

<img src="./frontend/public/screenshots/desktop.png" alt="webapp 在浏览器里跑 Claude Code 的截图" width="720">

</div>

## ✨ 特性

- **PTY 桥接** —— node-pty + xterm.js 5，完整 ANSI、alt-screen TUI 安全
- **Claude Code / TUI 适配** —— Ink/Yoga resize 不 reflow 修复、alt-screen 黑名单、"适配当前设备"PTY 尺寸接管
- **多实例** —— 每个实例独立子进程；一个浏览器 tab 栏全部展示，URL 即实例（`/i/<id>/`）
- **多客户端** —— 多浏览器 / `attach` 客户端共享同一实例，主从仲裁
- **移动端 PWA** —— IME guard、长按、滑动滚动、视口感知 fit，可"添加到主屏幕"
- **自定义快捷键 + 命令按钮** —— 设置面板里直接配屏幕按键、保存常用命令片段
- **重连回放** —— 每次重连自动回灌 scrollback，alt-screen TUI 不会一片空白
- **LAN-only 设计** —— token + 共享 session、`timingSafeEqual`、`/api/hook` 仅 loopback、worker 仅监听 127.0.0.1
- **WSL 感知** —— mirrored / NAT 自动检测，PowerShell 端口转发脚本即时生成
- **开机自启** —— `atr broker service install` 一键写 systemd / launchd 配置

完整清单见 [`docs/FEATURES.zh-CN.md`](./docs/FEATURES.zh-CN.md)。

## 🏛️ 架构

`atr` 是双进程模型：**broker** 负责对外入口与协调，**worker** 负责单个 PTY 实例。

```
        浏览器 / 手机                    本机 PC
        ┌──────────────┐                ┌─────────────────────────────────┐
        │              │   ws://host    │  broker (LAN: 0.0.0.0:3000)     │
        │  webapp PWA  │ ──────────────►│  ├─ /api/*  (auth/instances/... │
        │              │                │  │           push / config)     │
        │              │                │  ├─ /i/<id>/  → SPA + base href │
        │              │                │  ├─ /i/<id>/api/* → 反代 worker │
        │              │                │  └─ /i/<id>/ws    → 反代 worker │
        └──────────────┘                │            │                    │
                                        │            ▼                    │
                                        │  worker A   worker B   …        │
                                        │  127.0.0.1: 127.0.0.1:          │
                                        │  3001       3002       …        │
                                        │  ├─ PTY (claude / shell / TUI)  │
                                        │  ├─ /api/health  /api/hook      │
                                        │  └─ /ws (PTY IO)                │
                                        └─────────────────────────────────┘
```

- **broker**（LAN 入口）：唯一对外暴露的进程，监听 `0.0.0.0:3000`。
  持有所有"系统级" API：登录、用户配置、实例列表、推送订阅、SSE 实时流；
  服务前端静态资源，自动给 `/i/<id>/` 注入 `<base href>`。永驻——开机起一次就够。
- **worker**（PTY 实例）：每个实例一个独立子进程，仅监听 `127.0.0.1` 高位端口；
  只暴露 `/api/health`（探活）、`/api/hook`（loopback only）、`/ws`（PTY IO）。
  由 broker 通过 `POST /api/instances` 派生，detached + unref 后独立生命周期。
- **共享 session**：broker / worker 共用文件锁的 sessions store，cookie 一处签发处处认。
- **入口模型**：浏览器永远访问 broker；URL `/i/<id>/` 区分实例，刷新不丢上下文，单 PWA 多实例。

模块图与详细数据流见 [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md)；
设计决策（broker/worker 分离、永驻、API 归属、base href 注入等）见
[`docs/plans/path-routing/adrs/`](./docs/plans/path-routing/adrs/)。

## 📦 安装

```bash
npm install -g auvezy-terminal-remote   # 必须 -g（这是 CLI 工具）
```

> ⚠️ npm 包页面右上角自动显示的 `npm i` 命令**缺 `-g`**，没 `-g` 装完不会暴露
> `atr` 命令。

## 🚀 快速开始

### 一次性启动后台服务（推荐：开机自启）

```bash
atr --install            # 写 systemd（Linux/WSL2） / launchd（macOS）配置
# 之后按提示 enable + start，开机自动起后台服务
```

或手动启动一次（测试 / 不需要开机自启时）：

```bash
atr --start              # 前台跑，Ctrl+C 退；服务化请走上面那条
```

### 浏览器打开

```bash
atr --status             # 一屏看清：进程 / token / 入口 URL / 实例
```

输出里"可访问入口"那段每条 URL 都带 `?token=<token>`，复制任一条到浏览器即自动登录。
默认入口标 ★（Tailscale 优先 → LAN → IPv6 → loopback）。

webapp 打开后看到主界面，点 "+ 新实例"选 cwd 即可创建一个 PTY 实例（默认跑 `$SHELL`，可在 cwd 内手动起 claude 等）。

### 直接派生一个实例（CLI 兼容旧用法）

```bash
atr                          # 跑当前 $SHELL
atr claude                   # 跑 claude
atr claude --resume foo      # 额外参数自动透传
```

CLI 启动会自动确保后台服务在线（不在则 fork 一个），然后派生实例并打印对应 URL。

## 🔧 用法

```
atr <服务级 flag>                       管理后台服务（紧跟 atr，不能与下面共用）
atr [启动 flag...] [program] [args...]  启动一个 PTY 实例
atr <子命令> [参数]                      实例级操作
```

### 服务级 flag（紧跟 atr 之后；互斥）

| Flag | 用途 |
|---|---|
| `atr --start` | 启动后台服务（前台进程，Ctrl+C 退） |
| `atr --stop` | 关闭后台服务（SIGTERM → 5s 宽限 → SIGKILL） |
| `atr --status` | 一屏看清服务详情：进程、token、入口 URL、实例 |
| `atr --list` | 列当前所有活实例 |
| `atr --logs` | tail 当天后台日志（`~/.atr/broker-YYYY-MM-DD.log`） |
| `atr --install` | 注册开机自启（systemd / launchd） |
| `atr --uninstall` | 卸载开机自启 |

### 启动 flag（用于 `atr [program]`）

| Flag | 用途 |
|---|---|
| `-p, --port <n>` | 后台服务端口（默认 3000）。实例端口由后台自动分配 |
| `--name <s>` | 实例名（webapp 显示用） |
| `--no-terminal` | 不打印二维码（CI / 守护进程友好） |
| `--workdir <path>` | 子进程工作目录 |
| `--token <s>` | 指定固定 token（默认从 `~/.atrrc` 读 / 自动生成） |

### 实例级子命令

| 命令 | 说明 |
|---|---|
| `atr stop [pattern]` | 停指定实例（按 name / cwd / host:port 子串匹配；不传 pattern = 全停） |
| `atr attach <url>` | 命令行客户端连入某实例（第二个本地终端共享同一 PTY） |

完整参考（所有 flag、env、配置文件）见 [`docs/CLI.zh-CN.md`](./docs/CLI.zh-CN.md)。
跑 `atr -h` 查看内置帮助。

## 📂 文件位置

| 路径 | 内容 |
|---|---|
| `~/.atrrc` | 主配置：token、用户偏好、快捷键、命令片段 |
| `~/.atr/instances.json` | 当前活实例注册表（broker / worker 共享） |
| `~/.atr/broker.json` | broker 进程状态（pid / port / 启动时间） |
| `~/.atr/broker-YYYY-MM-DD.log` | broker 进程日志（按天切，保留 7 天） |
| `~/.atr/sessions/` | 共享 session 文件 |
| `~/.atr/vapid-keys.json` | Web Push VAPID 密钥 |
| `~/.atr/push-subscriptions.json` | 已订阅的推送终端 |

## 📱 安装为 PWA

webapp 自带 manifest，可"添加到主屏幕"获得近原生 app 体验：无浏览器 UI、状态栏与 app 同色。

- **iOS Safari** —— 分享按钮 → "添加到主屏幕"
- **Android Chrome** —— 右上角 ⋮ → "安装应用"

## 🌐 WSL → Windows 浏览器

WSL2 在 **mirrored 模式** 下开箱即用。**NAT 模式** 下 banner 会打印一段
PowerShell 命令，跑一次就能从 Windows 访问该端口。详见
[`docs/WSL.zh-CN.md`](./docs/WSL.zh-CN.md)。

## 🛣️ 路线图

计划中 / 评估中 / 明确不做的功能见 [`docs/ROADMAP.zh-CN.md`](./docs/ROADMAP.zh-CN.md)。
README 里只列已经实现的。

## 🛠️ 开发

```bash
git clone https://github.com/jjj201200/auvezy-terminal-remote.git
cd auvezy-terminal-remote
bash install.sh            # 检查 Node 20+ / pnpm 9+ / 编译依赖 → 装包 → 构建
```

dev 启动顺序（broker 先于 vite）：

```bash
# 终端 1：起 broker（dev 模式，tsx 直跑 src）
pnpm --filter auvezy-terminal-remote exec tsx src/cli.ts broker start

# 终端 2：vite dev server，反代 /api 与 /i/ 到 broker (3000)
pnpm --filter auvezy-terminal-remote-frontend dev
# 浏览器打开 http://localhost:5173/
```

跑测试：

```bash
pnpm test                  # shared + backend + frontend 单测
```

Gitee 镜像（国内访问更快）：
`git clone https://gitee.com/drowsyflesh/auvezy-terminal-remote.git`

## License

[PolyForm Noncommercial 1.0.0](./LICENSE) —— 个人 / 学习 / 非营利组织可自由使用、修改、再分发；
商业用途需另外获得授权。
