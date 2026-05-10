# 已实现特性

`auvezy-terminal-remote` 当前版本的完整能力清单。
未实现 / 计划中条目见 [路线图](./ROADMAP.md)。

[English](./FEATURES.md) · [简体中文](./FEATURES.zh-CN.md)

## 核心终端

- 完整 PTY 桥接（node-pty + xterm.js 5），ANSI 颜色、alt-screen / TUI 友好的滚动缓冲、可配置 ANSI 过滤
- 重连回放 —— 每次重连 `OutputBuffer` 自动回灌 scrollback；alt-screen 全程类 TUI（claude / tmux / vim / htop …）由可扩展黑名单保护，重连不会一片空白
- 增量重画修复（针对 Ink / Claude / Yoga 这类 resize 后不会自动 reflow 的 TUI，使用 double-pulse 策略）
- 会话 TTL + 空闲断连处理，可配置

## 多实例

- 一个终端跑一个 `atr` —— 每个实例自动占下一个空闲端口（3000、3001、3002…），同一个浏览器顶栏 tab 全部展示，点击切换
- `instances/<port>.json` 注册表，文件锁 + 原子写、僵尸 PID 清理、本机所有实例共享 token
- `atr list` / `atr kill <pattern|all>` / `atr attach <url>` / `atr completion <shell>` 子命令

## 多客户端（master / slave 主从仲裁）

- 同一实例可同时连入多浏览器 / 多 tab / `attach` 客户端
- 主从仲裁：webapp > attach > 本机 PC，可按会话切换
- 顶栏"适配当前设备"按钮，让 PTY 尺寸接管到当前活跃设备的视口

## 移动端 webapp

- PWA（manifest + service worker），iOS Safari / Android Chrome 可"添加到主屏幕"，运行时无浏览器 UI、状态栏与 app 同色
- 移动端输入：专用输入栏 + 工具栏 + IME composition guard（隔离 iOS / Android 键盘的预测输入污染）
- 触摸手势：长按进度指示、滑动滚动、动量保留、虚拟键盘安全区适配、视口感知 fit
- 移动端实例切换 sheet + 分享 sheet（URL / 二维码复制）
- iOS 专项：禁用 WebGL、helper-textarea 预测输入抑制、focus 劫持兜底
- 认证页三入口：粘贴 token / 摄像头扫码 / 粘贴完整 URL

## 设置面板

在 webapp 内调，写回 `~/.auvezy/terminal-remote/config.json`。

- 通用（语言、主题、字号、字间距）
- 显示（xterm 主题选择，含 16 色 / Campbell / 自定义）
- 快捷键（自定义按键，分桶分组，拖拽排序）
- 命令（保存的命令片段，分组）
- 控制（输入模式切换、TUI tap-to-focus、scrollback 选项）
- 网络（display-IP 覆盖、CORS allow list 查看）
- 操作（实例级快捷动作）
- 关于（版本、仓库链接、协议）
- 开发者 tab（debug 开关、console-bridge 配置）

## 鉴权与安全

- 64 位 hex token，`timingSafeEqual` 比较
- 端口绑定 session cookie（cookie name 按端口加后缀 → 多实例间不会串）
- 默认仅绑 LAN；`OCR_CORS_ALLOW` 可配置 CORS allow list
- `/api/hook` 仅接受 loopback（127.0.0.1 / ::1）
- 工作目录白名单防路径穿越
- 配置文件 0o600，目录 0o700
- 鉴权请求 per-IP 限流

## 网络感知

- IP 漂移检测：30s 轮询 + 稳定阈值，向客户端广播 `ip_changed` 并弹 toast 提示
- 多网卡 display IP 启发式 + 诊断 banner 输出（LAN + Tailscale 双码）
- WSL2 mirrored / NAT 模式自动检测 + 首次启动生成 PowerShell 端口转发脚本 —— 见 [WSL 指南](./WSL.md)

## CLI 体验

- Banner 含彩色二维码（LAN + Tailscale 可用时双码）
- `--dev-proxy` 本地前端开发（vite 端口 5173–5180 自动探活，10s 缓存）
- 完整 flag 列表见 [CLI 参考](./CLI.md)

## 审批 hook（Claude Code 集成）

- `/api/hook` 接受 Claude 审批事件（仅 loopback）
- `console-bridge`：前端 `console.*` 经 WS 转发到 backend stderr，方便跨设备调试

## 速查（技术映射）

| 功能 | 实现 |
|---|---|
| PTY 桥接 | node-pty + xterm.js 5 |
| 鉴权 | timingSafeEqual token + Session Cookie（端口绑定）|
| 多实例 | port-finder 自动递增 + cookie name 后缀隔离 |
| 重连回放 | OutputBuffer + history_sync（默认过滤 alt-screen）|
| IP 漂移检测 | 30s 轮询 + 稳定阈值 + ip_changed 广播 |
| 配置改写 | webapp Settings 弹窗 → /api/config |
| attach 子命令 | 主从仲裁（webapp > attach > PC）|
