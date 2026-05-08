<div align="center">

<img src="./frontend/public/icons/atr-icon.svg" alt="auvezy-terminal-remote logo" width="96" height="96">

# auvezy-terminal-remote

[![npm](https://img.shields.io/npm/v/auvezy-terminal-remote?style=flat-square&color=b6f09c&labelColor=0a0c0f)](https://www.npmjs.com/package/auvezy-terminal-remote)
[![license](https://img.shields.io/badge/license-PolyForm--NC--1.0.0-b6f09c?style=flat-square&labelColor=0a0c0f)](./LICENSE)
[![node](https://img.shields.io/node/v/auvezy-terminal-remote?style=flat-square&color=b6f09c&labelColor=0a0c0f)](https://nodejs.org)
[![stars](https://img.shields.io/github/stars/jjj201200/auvezy-terminal-remote?style=flat-square&color=b6f09c&labelColor=0a0c0f)](https://github.com/jjj201200/auvezy-terminal-remote)

[English](./README.md) · **简体中文**

局域网内通过手机 / 平板浏览器远程控制 PC 上的任意终端程序。
一行命令 `atr [program]`，多终端多实例自动出现在浏览器顶栏 tab 切换。

<img src="./frontend/public/screenshots/desktop.png" alt="webapp 在浏览器里跑 Claude Code 的截图" width="720">

</div>

## ✨ 特性

- **PTY 桥接** —— node-pty + xterm.js 5，完整 ANSI、alt-screen TUI 安全
- **Claude Code / TUI 适配** —— Ink/Yoga resize 不 reflow 修复、alt-screen 黑名单、"适配当前设备"PTY 尺寸接管
- **多实例** —— 每个 `atr` 自动占下一个空闲端口；同一个浏览器 tab 栏全部展示
- **多客户端** —— 多浏览器 / `attach` 客户端共享同一实例，主从仲裁
- **移动端 PWA** —— IME guard、长按、滑动滚动、视口感知 fit，可"添加到主屏幕"
- **自定义快捷键 + 命令按钮** —— 设置面板里直接配屏幕按键、保存常用命令片段
- **重连回放** —— 每次重连自动回灌 scrollback，alt-screen TUI 不会一片空白
- **LAN-only 设计** —— token + 端口绑定 cookie、`timingSafeEqual`、`/api/hook` 仅 loopback
- **WSL 感知** —— mirrored / NAT 自动检测，PowerShell 端口转发脚本即时生成

完整清单见 [`docs/FEATURES.zh-CN.md`](./docs/FEATURES.zh-CN.md)。

## 📦 安装

```bash
npm install -g auvezy-terminal-remote   # 必须 -g（这是 CLI 工具）
```

> ⚠️ npm 包页面右上角自动显示的 `npm i` 命令**缺 `-g`**，没 `-g` 装完不会暴露
> `atr` 命令。

## 🚀 快速开始

```bash
atr                       # 跑当前 $SHELL（zsh / bash 自动检测）
atr claude                # 跑 claude
atr claude --resume foo   # 额外参数自动透传给 claude
```

启动后扫终端打印的二维码 → webapp 自动登录（token 在
`~/.auvezy/terminal-remote/config.json`）。

在不同终端多次 `atr` 就能多开实例，浏览器顶栏 tab 实时刷新。

## 🔧 用法

```
atr [atr 自身 flag...] [program] [program 参数...]
atr <子命令> [参数]
```

最常用 flag：

| Flag | 用途 |
|---|---|
| `-p, --port <n>` | 端口（默认 3000，自动递增） |
| `--name <s>` | 实例名（webapp 显示用） |
| `--no-terminal` | 不打印二维码（CI / 守护进程友好） |
| `--workdir <path>` | 子进程工作目录 |
| `--token <s>` | 指定固定 token（默认自动生成） |

子命令：`atr list` · `atr stop [pattern]` · `atr attach <url>`。

完整参考（所有 flag、env、配置文件）见 [`docs/CLI.zh-CN.md`](./docs/CLI.zh-CN.md)。
跑 `atr -h` 查看内置帮助。

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

## 🏛️ 架构

- 模块图与数据流：[`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md)
- 设计文档与 ADRs：[`docs/plans/open-claude-remote-clone/`](./docs/plans/open-claude-remote-clone/)

## 🛠️ 开发

```bash
git clone https://github.com/jjj201200/auvezy-terminal-remote.git
cd auvezy-terminal-remote
bash install.sh           # 检查 Node 20+ / pnpm 9+ / 编译依赖 → 装包 → 构建
pnpm dev                  # backend（tsx watch）+ frontend（vite）并行
pnpm test                 # shared + backend + frontend 单测
```

Gitee 镜像（国内访问更快）：
`git clone https://gitee.com/drowsyflesh/auvezy-terminal-remote.git`

## License

[PolyForm Noncommercial 1.0.0](./LICENSE) —— 个人 / 学习 / 非营利组织可自由使用、修改、再分发；
商业用途需另外获得授权。
