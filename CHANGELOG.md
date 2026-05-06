# Changelog

格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号符合 [SemVer](https://semver.org/lang/zh-CN/)。

## [Unreleased]

## [0.4.2] - 2026-05-07

### Added

- `detectDisplayIp` 在 banner 上方打印一行诊断输出（候选分组 + 最终选取的 IP），
  方便诊断"为什么 displayIp 选了一个不该选的 IP"。可通过环境变量
  `ATR_DEBUG_NETWORK=0` 关闭。

## [0.4.1] - 2026-05-07

### Fixed

- **多网卡宿主机（Hyper-V / WSL / VMware / Docker bridge）跨设备访问无限重连**：
  Windows 上同时挂 Tailscale + 真实 LAN + 一堆虚拟桥时，`detectDisplayIp` 早期
  按 `networkInterfaces()` 枚举顺序取第一个 RFC1918 私网 IP，结果常被
  `vEthernet (WSL) 172.27.16.1` 这种宿主机本地虚拟网卡抢走 → 写进 instances
  registry → 手机走 Tailscale 打开页面后，前端拿到的 host 是 `172.27.16.1`，
  跨网段连不上 → WS 死循环重连。两层修复：
  - 后端 `detectDisplayIp` 调整优先级：Tailscale (100.64/10) > 真实 LAN
    (192.168 / 10) > 172.16/12 段（多数为虚拟桥）> link-local > 127.0.0.1
  - 前端 `buildWsUrl` 同源判定从 `hostname === host` 改为 `port === port`：
    一台机的 backend 只能 bind 一个端口，端口相同就是同 backend，直接走同源
    cookie；跨实例（跨 port）时用当前页面 hostname 拼 URL 而不是 registry 里
    的 host，确保用户能 reach 的路径不被覆盖。`buildInstanceUrl` 同思路修复。

## [0.4.0] - 2026-05-07

本次重点解决移动端浏览器跑 Claude Code（React Ink TUI）的渲染稳定性 +
多端共连同一实例时的尺寸主控冲突。同时清理 iOS 调起输入法的一系列连锁问题。

### Fixed

- **iOS 移动端键盘弹起触发的渲染错乱**（一系列连锁修复）：
  - viewport meta 加 `interactive-widget=resizes-visual`（Chromium 系含
    Android Chrome，iOS Chrome/Safari 由 JS 兜底）
  - `useTerminal` resize 防抖三件套（参考 VS Code TerminalResizeDebouncer）：
    入口去重 + 防抖 300ms + 键盘冻结
  - 键盘弹起期跳过 `fitAddon.fit()`，xterm rows 维持原值，buffer 不抖
  - `.xterm` 元素 absolute bottom:0 从底部锚定，溢出顶部裁切，光标行始终
    贴键盘顶部（Blink/Termius 路线的 web 等价）
  - InputBar / Toolbar 跟着 root padding-bottom 自然上推；不加 transition
    避免键盘动画期 padding 滞后追赶
  - `useViewportFix` 双路键盘高度推算：visualViewport 路径 + iOS WebKit
    layout 缩小路径
- **iOS 上 xterm helper-textarea 预测输入污染 PTY**：手动设
  `autocomplete=off / autocorrect=off / autocapitalize=off / spellcheck=false`
- **iOS 上 WebGL renderer 已知问题**（键盘期 GPU 限流到 30fps + sleep-resume
  纹理 stale）：iOS 检测后跳过 `WebglAddon`，回退 DOM renderer
- **直接输入模式（useInputBar=false）iOS 输入丢失**：xterm helper-textarea
  在 iOS WebKit 上 input 事件不可靠（仅退格 keydown 有效）。新增
  `DirectInputCapture` 自挂透明 textarea 接管输入，绕开 helper-textarea
- **移动端键盘焦点闪烁** + 桌面焦点抢夺：终端区改用单一 `onClick` →
  同步 focus InputBar / DirectInputCapture（在 user gesture 内 → iOS 软
  键盘正常弹起）
- **Claude Code (Ink) resize 后已渲染历史不 reflow**（架构限制）：
  `pty-manager.ts` resize 路径加 double-pulse hack —— 先 resize(cols-1)
  让 Ink 走 width-shrink 分支强制清屏，50ms 后 resize(cols) 回到目标尺寸。
  alt-screen 内（vim/htop/tmux）和缩窄场景跳过此 hack。通过扫描 PTY 输出
  的 DECSET 1049/1047/47 序列实时维护 `_inAltScreen` 标志
- **`.terminalView` padding 双减导致最下方一行只渲染一半**：去掉 padding，
  FitAddon `proposeDimensions` 用 parent 的 border-box height 减 `.xterm`
  自身 padding（无），不会减 parent padding，结果会把 padding 算进可用 rows
- **SearchBar 浮层遮挡终端**：从 absolute 改为 flex 普通项，open 时占行高
  自然挤压 terminalWrap

### Added

- **多端共连主控（master）机制**：协议 `ResizeMessage` 加可选 `master?:
  boolean`。SessionController 仲裁规则——master 声明最高优先级（覆盖客户端
  类型仲裁），当前有主控且非自己则忽略 resize，主控连接断开自动释放。解决
  PC 浏览器 ResizeObserver 反复发的宽 cols 覆盖手机的窄 cols 问题
- **顶栏「适配当前设备」按钮**（IconArrowAutofitWidth）：active 实例可见时，
  点击调用 `useTerminal.adaptToDevice()` —— fit + emit master=true，绕开
  去重 / 防抖 / 键盘冻结，立即抢主控
- **状态 pill 紧凑模式 + 点击弹说明 modal**：≤640px 窄屏下 Pill 仅显示圆点
  （文字隐藏给读屏），节省顶栏空间。任一 pill 点击弹 ConfirmModal 解释当前
  状态含义（每个状态有专门描述）
- **设置面板「开发」tab**：
  - eruda 调试浮层开关（屏幕角落注入 console / network / 元素，本地 storage
    持久化）
  - 控制台桥接（console-bridge）开关：把前端 console 输出经 WS 转到 backend
    stderr，开发者可 `tail -f` 看；带设备 / 实例 tag 区分多端来源
- **设置面板重构**：tab 顺序 常规 → 显示 → 快捷键 → 命令 → 网络 → 开发
  （通知 tab 暂时隐藏）；新增「常规」tab 含语言切换 + 输入方式（底部输入栏 /
  直接输入）
- **直接输入模式（useInputBar=false）**：通过 `UserConfig.input.useInputBar`
  持久化偏好，false 时隐藏 InputBar，xterm 直接接收键盘事件并实时透传 PTY
- **Roadmap**：README 末尾补充按 ROI 排序的"值得抄"清单（基于成熟项目调研）

### Changed

- **InputBar 改为 textarea**：原生支持 IME composition / 中段编辑 / 方向键
  原生光标移动（行编辑场景体验大幅提升）
- **MobileInstanceSwitcher trigger 改透明按钮**：去边框 / 去背景，hover 背景
  淡入 + active 缩放给交互反馈
- **ScrollNavButtons 替换 ScrollToBottomButton**：方形主题 + 半透明背景
  （`backdrop-filter: blur`）让用户能看到按钮下被遮挡的内容
- **i18n 框架完善**：英文 / 中文双语 messages.ts 类型校验

### Internal

- 新增 backend `pty-manager.test.ts` double-pulse + alt-screen 检测测试
  （+3 个用例）；新增 `config.test.ts` 配置相关补充测试
- shared `ws-protocol.ts` 新增 `ClientLogMessage` 协议
- backend `ws-handler` 新增 `client_log` 消息类型路由到 stderr
- Gitee 仓库重命名 open-terminal-remote → auvezy-terminal-remote，git
  remote URL 切换（之前依赖重定向）

## [0.3.1] - 2026-05-06

### Fixed

- **`atr claude` 启动后本地键盘失控**（仅在"先开浏览器扫码登录后再回到本地敲键"
  这条路径触发；zsh 等非 TUI 程序不易复现）。
  根因：默认 race 路径里 `waitForUserConfirm({silent:true})` 在 stdin 上挂的
  `'data'` listener，在 webapp 触发 `startPty` 后没被清理。用户回本地按第一个键
  时它先 `cleanup() → process.stdin.pause()`，后续 `TerminalRelay` 永远收不到
  data。
  修法：`waitForUserConfirm` 返回 `{ promise, cancel }` 句柄，webapp / timeout
  触发 spawn 时主动 `cancel()`（移除 listener 但**不**调 `pause()`）。

## [0.3.0] - 2026-05-06

> ⚠️ 包名 / CLI / 数据目录 / 缩写全面迁移：旧版 `@jjj201200/open-terminal-remote`
> （CLI: `otr`，数据: `~/.open-terminal-remote/`）已停止发布；新包
> `auvezy-terminal-remote`（CLI: `atr`，数据: `~/.auvezy/terminal-remote/`）。
> 老用户需手动迁移配置文件。

### Changed (rename)

- npm 包名: `@jjj201200/open-terminal-remote` → `auvezy-terminal-remote`
  - 早期试过 `@auvezy/terminal-remote` scope，但 npm 拒绝创建 `@auvezy`
    organization（疑似保留词），改用纯前缀 `auvezy-`
- CLI 命令: `otr` → `atr`
- 环境变量: `OTR_DEBUG_SPAWN` / `OCR_INJECT_SETTINGS` / `OCR_DEV_PROXY` → `ATR_*`
- 数据目录: `~/.open-terminal-remote/` → `~/.auvezy/terminal-remote/`
- localStorage prefix: `ocr.*` → `atr.*`
- PWA 资源: 应用名 `Open Terminal Remote` → `Auvezy Terminal Remote`，
  图标 `otr-icon-*` → `atr-icon-*`

### Added

- **多实例 SSE 实时同步**：新增 `GET /api/instances/stream` SSE 端点，
  backend 用 `fs.watch(instances.json)` 监听文件变更（任何 backend 调
  register/unregister/list-with-prune 都会推一条 `instances` 事件）。前端
  `useInstances` 主路径切到 EventSource，30s 轮询降级为兜底。pending →
  real 的延迟从最长 3.7s 拍超时降到几十毫秒级
- **页内 ConfirmModal**：新增通用 `components/ui/ConfirmModal.tsx`（基于
  Sheet 的双形态），替代 `window.confirm`/`alert`。支持单/双/三按钮、
  default/danger 色调、模板插值高亮关键变量（实例名等）
- **关闭 vs 断开 二选一**：tab 关闭按钮触发 ConfirmModal，提供：
  - **关闭**（红色）：DELETE 进程，所有设备失去连接
  - **断开**（绿框）：仅本设备关 WS，backend 进程仍在跑、其他设备照常用
  - 取消
- **本机断开持久化**：新增 `services/disconnected-instances.ts` +
  `hooks/useDisconnected.ts`（localStorage 持久化 + 跨 tab 同步）。被本机
  断开的实例 InstanceView 显示"已断开 — 点击重连"覆盖层；StatusBar 重连
  也会清掉这个标记
- **创建实例最近列表**：`services/recent-instances.ts`（localStorage LRU
  5 条，cwd 去重）。CreateInstanceModal 的 cwd 输入框 focus 弹下拉，
  点击填充（不自动 submit），每条右侧 × 删除单条。回车顺序：cwd → name → submit
- **占位 tab 原地变真实**：dev 模式下 spawner 拿到的是 tsx wrapper pid（≠
  backend 子进程的 process.pid），用 (cwd 一致 && instance.startedAt ≥
  pending.startedAt - 1s) 兜底命中规则；claimed Set 防多 pending 抢同一
  real。pending 60s 兜底超时，可手动重连或关闭占位

### Fixed

- **关闭活跃实例后老 tab 残留**：跳转到新 origin 后 `?killAfterSwitch=<oldId>`
  query 让新 backend DELETE 老进程；isCurrent vs activeId 拆分为两个 prop
  避免覆盖；stopInstances pattern 用 `host:port` 而非 instanceId（uuid 不
  会 substring 命中 name/cwd/host:port）
- **ConfirmModal 死循环**：`MultiInstanceConsole` 给 InstanceView 派发的
  `onStatusChange` / `registerReconnect` 在每次 render 都生成新闭包，触发
  InstanceView effect setState → 父重 render → 又新闭包。改成稳定签名
  `(instanceId, ...)` + ref 镜像可变依赖；`useDisconnected` setSet 加内容
  比对，相同内容不更新引用

## [0.3.0-legacy] - 2026-05-06

> 旧包名时期（`@jjj201200/open-terminal-remote`，CLI: `otr`）的最后一个版本，
> 已从 npm 下架。保留此节作历史记录；当前 npm 上的 `auvezy-terminal-remote@0.3.0`
> 对应上方"0.3.0"节。

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
