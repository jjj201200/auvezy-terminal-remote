# Changelog

格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号符合 [SemVer](https://semver.org/lang/zh-CN/)。

## [Unreleased]

## [0.3.0] - 2026-05-06

### Added

- **顶栏分享按钮**：设置左侧新增分享按钮（IconShare2），打开 sheet 含：
  - **可选入口列表**：通过 `GET /api/share/endpoints`（鉴权）拉取所有可访问入口
    （LAN / Tailscale / Loopback / IPv6 / VPN），按 kind 分组排序，默认选 displayIp
  - **二维码**：随入口切换实时联动，前端 qrcode 渲染（磷光绿前景 + 深底）
  - **完整 URL**：含 token；token 默认隐藏 ••••，可一键显示
  - **一键复制**：navigator.clipboard，IconCheck 1.6s 反馈
  - **刷新按钮**：重拉入口（接 VPN / 切网卡后用）
  - **dev 端口提示**：当前页面端口 ≠ 后端真实端口时（vite :5173 ↔ 后端 :3000），
    顶部条提示「分享链接指向真后端（手机扫码用这个）」，避免开发者疑惑
  后端不返回 token（API 仅暴露 host:port），由前端从 localStorage 拼接
- **dev 反代 `--dev-proxy <port>`**：本地调试时把后端非 /api、/ws 的 HTTP/WS
  请求转发到 vite dev server（通常 :5173），让手机扫码访问真后端端口也能拿到
  HMR 实时前端，省掉每次 `pnpm build`。`OCR_DEV_PROXY` env 等价。退出时
  `dispose()` 摘 upgrade 监听 + 销毁所有 tracked socket，零残留
- **断线手动重连**：StatusBar 在 `connection=disconnected` 时连接 Pill 变成可点击按钮
  （"已断开 · 重连"），点击立即调 `ws.connect()`，省掉等待最长 30s 的指数退避
- **PWA 支持**：新增 `manifest.webmanifest` + 帅气 SVG icon（终端 prompt + 信号弧，
  磷光绿配色），Android Chrome 可"安装应用"、iOS Safari 可"添加到主屏幕"得到
  全屏沉浸式体验（隐藏地址栏 / 底部导航）。backend 显式声明 `.webmanifest` 的
  MIME 为 `application/manifest+json`，确保浏览器识别
- **PushToggle 诊断分级**：把笼统的"不支持"细分为
  `需 HTTPS`（LAN HTTP 场景，浏览器强制 secure context）/
  `不支持`（API 缺失，旧浏览器/iOS<16.4），用户立刻知道下一步怎么做

### Fixed

- **ShareSheet IPv6 入口刷屏**：`os.networkInterfaces()` 返回的 link-local
  (`fe80::/10`)、临时地址（隐私扩展每几小时轮换）、scopeid≠0 等地址绝大多数
  不可达，过去全部塞进入口列表造成视觉噪音。新增 `isShareableIpv6()` 仅保留
  GUA / ULA，且同一网卡 IPv6 只取第一个稳定地址
- **ShareSheet 窄屏宽度**：`.sheet { max-width: 480px }` 之前在 <768px 移动 vaul
  Drawer 上也生效，把弹层挤窄。改为 `@media (min-width: 768px)` 守卫，
  仅桌面 dialog 限宽，移动端走全宽（与 SettingsModal 行为一致）
- **xterm `RenderService dimensions undefined` 偶发报错**：xterm 5.5 内部 RAF /
  timer 链在容器 portal 切换 / Sheet 打开时刻异步访问 `_renderService.dimensions`，
  此时尚未 realloc 触发 TypeError。ResizeObserver 已加 try-catch 但覆盖不到
  内部异步链，新增窗口级 error listener 仅吞这一条特定 message（match
  `RenderService` / `Viewport` 栈帧），useEffect cleanup 同步移除避免 HMR 泄漏
- **macOS 上 `posix_spawnp failed` 根因修复**：`npm pack` 把 tar 中的文件 mode
  normalize 成 0o644，丢失 `node-pty/prebuilds/<plat>-<arch>/spawn-helper` 的 +x 位。
  macOS 走 spawn-helper 派生 PTY，没执行权限即 `posix_spawnp failed`（Linux 走 forkpty
  不受影响）。新增 `postinstall` 脚本扫描白名单（仅 node-pty 的 spawn-helper），
  install 后自动 `chmod 0o755`，零额外操作即开即用
- **认证日志噪音根因修复**：useAuth 优先用 URL `?token=` 而非 localStorage 缓存
  做静默重认证（解决"扫码进来但前端先用旧缓存 token 调 /api/auth → 后端 warn 噪音 →
  跳 AuthPage 让用户重输"的多余流程）；后端 token 无效从 warn 降级 info（这是预期事件）
- **PTY spawn 失败不再静默退出**：失败时不 shutdown(1)，保留 backend 在线，
  通过 ws `error` 消息把具体原因（如 `posix_spawnp failed`）写到前端终端区域，
  并 setStatus('idle') 让 loading overlay 消失。用户能在浏览器看到错误，不再面对空白
- **PTY spawn 时机根因修复**：默认立即 spawn 会被 claude/zsh 等全屏 TUI 立即清屏覆盖，
  banner / 二维码用户看不到；`--wait-confirm` 模式下用户先开浏览器又会看到空白。
  改为三选一 race：首个 webapp 连入 / 用户按 Enter / 30s 超时，任一触发即 spawn。
  banner 在 spawn 之前一直留屏；前端在 `pty_pending` 状态显示 loading 覆盖层
- **端口选择根因修复**：`findAvailablePort` 探测硬编码 `127.0.0.1`，与实际 listen 的
  `cfg.host`（默认 `0.0.0.0`）不一致；macOS 上 0.0.0.0 占用 + 127.0.0.1 探测会
  误判为可用，真 listen 时撞 EADDRINUSE 直接退出。新增 `bindAvailablePort`
  把探测 + 真实 listen 合并到同一循环，probe/listen 共用 host，listen 失败
  自动跳到下一个候选端口（覆盖多实例并发抢端口的 TOCTOU 场景）

### Added

- **`-S, --strict-port`**：严格端口模式；preferred 被占即报错退出，不自适应递增。
  适合 CI / 反向代理后端等"必须固定端口"的部署。环境变量 `STRICT_PORT=true` 等价
- **CLI 短选项**：`-p` (`--port`) / `-h` (`--help`) / `-v` (`--version`) /
  `-S` (`--strict-port`)
- **`--spawn-timeout <s>`**：PTY spawn 兜底超时秒数（默认 30；0 = 无超时）。
  环境变量 `OCR_SPAWN_TIMEOUT` 等价。`--wait-confirm` 模式下被忽略
- **协议字段 `pty_pending`**：`SessionStatus` 新增此值，表示 backend 已 listen 但 PTY 未 spawn。
  前端 ConsolePage 在此状态显示"正在启动终端"覆盖层，避免空白误解

### Changed

- **前端样式整体重写**：Tailwind v4 + Radix Primitives + vaul + lucide-react；
  删除 690 行手写 BEM；CSS token 走 `@theme` 注入
- **移动端布局根因修复**：`100dvh` + `useViewportFix` hook，
  键盘弹起时输入栏紧贴键盘上沿（不再被 100vh 挤出一屏）
- **快捷键设置乱码修复**：UI 编辑层 `\e \r \n \t \xHH` 双向编解码（28 个单测保护）；
  协议 / 落盘字段仍是真控制字节，跨端共享配置零兼容包袱
- **设置面板**：桌面 modal / 移动 sheet 自适应；新增"通知"分页（PushToggle 内嵌）
- **创建实例面板**：同样 sheet 化
- **InstanceTabs**：拆桌面（横向 tab）/ 移动（右上角按钮 + sheet 列表）两形态
- **顶栏合并**：原 InstanceTabs + StatusBar 两行合一行；PushToggle 移入设置；
  设置入口从 InputBar 移到顶栏
- **全局移除 emoji**（🔔 ⚙ ⚠）：改用 lucide 单色 stroke 图标
- **字号梯度收紧**：6 档（10/11/12/13/14/15px），默认 13px

### Removed

- `analysis/upstream/` 上游参考材料（clean-room 复刻已完成）

## [0.1.0] - 2026-05-05

首个可用版本。覆盖上游 `open-claude-remote@0.1.1` 主要功能（Clean-room 复刻），
裁剪 OnboardingGuide 与钉钉通知。

### Added

- **协议层（@otr/shared）**：ServerMessage / ClientMessage union、
  ErrorCode 枚举、协议常量；frontend 与 backend 共用唯一来源
- **PTY 桥接**：node-pty + xterm.js 5 + 三阈值批合并（16ms / 32KB / 256KB）
- **重连回放**：OutputBuffer + history_sync（默认过滤 alt-screen 1049）
- **认证**：timingSafeEqual token + Session Cookie（端口名后缀绑定多实例）
- **限流**：令牌桶 / 分钟（默认 10）
- **配置体系**：`~/.claude-remote/config.json`（0o600 + 原子写）+ webapp Settings
- **审批 hook**：HookReceiver loopback-only + Web Push（VAPID 三优先级）+
  iOS Safari < 16.4 LocalNotification fallback
- **多实例**：port-finder 自动递增 + InstanceRegistry（mkdir-as-lock）+
  webapp 标签页 + 命令行 list/stop
- **attach 子命令**：命令行 stdin/stdout 接管 + 主从仲裁（webapp > attach > PC）
- **IP 漂移**：30s 轮询 + 稳定阈值 + ip_changed WS 广播 + 前端 toast
- **打磨**：install.sh 一键安装、README 用户视角、ARCHITECTURE 开发者视角

### Decisions（ADR）

详见 [`docs/plans/open-claude-remote-clone/adrs/`](./docs/plans/open-claude-remote-clone/adrs/)：

- 002 mkdir-as-lock 文件锁选型
- 003 Cookie 名后缀绑端口
- 004 webapp/attach 主从仲裁
- 007 启用 AlternateScreenFilter（与上游不同）
- 008 Web Push VAPID 三优先级
- 009 错误体系（AppError + ErrorCode）
- 010 裁剪 OnboardingGuide / 钉钉通知

### Tested

- 单元：284 backend / 15 shared / vitest
- 集成：每阶段独立 smoke（`backend/scripts/smoke-stage*.mjs`）
- 跨阶段：`backend/scripts/smoke-cross.mjs`（健康 → 登录 → WS 收发 →
  配置改写 → 实例列表 → VAPID）
