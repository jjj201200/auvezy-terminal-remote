# Changelog

格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号符合 [SemVer](https://semver.org/lang/zh-CN/)。

## [Unreleased]

## [0.7.3] - 2026-05-11

### Fixed

- **iOS / 屏拍二维码识别失败**:webapp 的"拍照扫码"路径之前用的是 jsQR(底层
  在 `qr-scanner` 包里),对屏拍样本(摩尔纹 + 反光 + 透视)鲁棒性极差,实测
  iOS 系统相机能识别的二维码 jsQR 完全解不出来。改用 `zxing-wasm`(ZXing-C++
  emscripten 产物,reader-only ~400KB gzipped,精度接近 iOS 原生 VisionKit)。
  - `tryHarder + tryRotate + tryInvert` 三档全开,精度优先(用户拍一张照解
    一次,慢一点没关系)。
  - WASM 二进制走 vite `?url` 资源导入,同源服务,LAN 部署也能跑(替代默认
    jsDelivr CDN 在内网失效的问题)。
- **多 broker 场景实例分组错乱**:registry 里 worker 的 `host` 永远是
  `127.0.0.1`(worker 监听 loopback),前端按 `host` 分组会把不同 broker
  的实例堆到一起。`InstanceInfo` 加 `brokerHost` 字段(broker 注册 worker 时
  写入自己外部可达地址),前端 `useHostGroups` 优先以 `brokerHost` 分组。
- **WSL2 mirrored 模式下 Tailscale IP 误选为入口地址**:WSL 镜像了 Windows
  宿主网卡(包括 Tailscale 100.x.x.x),但 WSL 进程实际访问不通。
  `entry-discovery` 在 WSL 下把 Tailscale 排序降到 LAN 之后,banner / share
  endpoints 优先返回真正可达的 192.x。

### Changed

- **移动端实例列表布局重排**:旧版 `justify-content: space-between` 让 port
  孤零零飘在中间。新版 `name + :port` 同行(port 字号 / 色阶对齐 PC 端
  `InstanceTabs` 的 `.tabPort`),`cwd` 整段折行不省略,右侧切换按钮贴底
  对齐;active 实例 port 染 accent 绿。

### Internal

- `broker/cli.ts` 的 `getCliPath()` 改为多候选探查(bundle / tsc dist /
  dev tsx),修复 dev 模式下 worker spawn 解析到错误入口导致"创建新实例
  超时"的问题。

## [0.7.2] - 2026-05-10

### Fixed

- **`atr start` 撞 3000 端口直接退出**:0.7.1 漏修的 bug —— broker 走的是裸
  `httpServer.listen(port)`,撞 EADDRINUSE 抛错就退出,而 worker 那边早就用
  `bindAvailablePort` 自适应递增。现在 broker 也走 `bindAvailablePort`,默认
  非严格,撞了自动 +1 直到找到可用端口;实际 port 与 preferred 不同时打印一行
  黄色提示("preferred port N was busy; bound to M instead")。
  - `--strict-port` flag 仍然生效:撞了直接拒,不自适应。
  - 已有 broker 但用户传 `-p` 显式期望另一个端口的场景,错误消息改成多行 hint
    指引"用旧 broker / `atr stop` 后重启"。

### Changed

- `port-finder.ts` 内部 InstanceError 消息英文化(对齐 0.7.0 起的 i18n)。

## [0.7.1] - 2026-05-10

### Breaking changes

- **服务级命令从 flag 改为 subcommand**(与 git/docker 一致):
  - `atr --start` → `atr start`
  - `atr --stop` → `atr stop`(无参,停 broker)
  - `atr --status` → `atr status`
  - `atr --list` → `atr list`
  - `atr --logs` → `atr logs`
  - `atr --install` → `atr install`
  - `atr --uninstall` → `atr uninstall`
- **`atr stop <pattern>` 停实例的语义迁到 `atr kill <pattern>`**:
  - 新 `atr stop` 无参,只停 broker(更符合"停服务"直觉)
  - 旧 `atr stop foo` → `atr kill foo`
  - **`atr kill` 必须显式给 pattern 或 `all`**:裸 `atr kill` 报错。`atr kill all`
    才会杀全部,且带二次确认。
- **保留词冲突处理**:`start`/`stop`/`status`/`list`/`logs`/`install`/`uninstall`/
  `attach`/`kill`/`completion` 在位置 0 一律识别为 subcommand。要跑同名 PATH
  二进制:`atr ./<name>` 或 `atr -- <name>`,或在交互环境下我们会 prompt 你选。

### Added

- **`atr completion <zsh|bash|fish>`** 子命令:输出对应 shell 的补全脚本到 stdout
  (用户自己决定 source 还是 append 到 rc 文件,不侵入 shell 配置)。
- **拼写建议(didyoumean2)**:
  - `atr stp` → "did you mean: atr stop?"
  - `atr --por 3000` → "did you mean: --port?"
  - `atr cluade` → 优先建议 reserved subcommand,否则扫 PATH 给最相似二进制名
- **彩色输出(picocolors)**:status section title 加粗、`running`/`stopped`/`OK`
  绿、`dead`/`FAIL` 红、`KILL`/`not running` 黄、`[atr]` 青、hint 灰。
  - `--no-color` flag、`NO_COLOR=1` env、stdout 非 TTY 一律自动禁色
- **交互确认(prompts)**:
  - `atr uninstall` 删 service 文件前二次确认
  - `atr kill all` 杀全部前二次确认
  - 保留词与 PATH 二进制冲突时 select 让用户选(非 TTY 默认走 subcommand)
- **严格参数顺序**:atr 自身的 flag 必须在 program 名之前。一旦遇到 program,
  之后所有 token 原样透传给子进程,atr 不再解析(没有歧义)。
  - `atr -p 3010 claude --port 9` → `-p 3010` 给 atr,`--port 9` 透传 claude
- **`atr [program]` 启动前 `resolveExecutable` 守卫**:`atr foo-not-exists`
  立即 exit 127,不会 ensureBroker / 写 instances.json,避免脏状态。

### Fixed

- **worker port 没写入 instances.json**:`bindAvailablePort` 在 `preferred=0` 时
  返回的是循环里的局部 `port=0`,而不是 OS 实际分配的高端口;现在用
  `server.address()` 取真实端口写入 registry。
- **`getBrokerVersion()` dev 模式显示 0.0.0**:原来 `__dirname/../package.json`
  在 tsc 分散输出 / dev tsx 路径下解析错;改成向上 3 层探查带
  `name === 'auvezy-terminal-remote'` 的 package.json,3 种入口位置都覆盖。
- **banner `║` 列对齐**:`row()` / `center()` helper 修正 padding 计算。
- **0.7.0 ensureBroker fork 失败**:删除旧 `atr broker xxx` 子命令后 fork 还在
  传 `'broker', 'start'` 导致 broker 永远起不来。现在 fork 用 `start` subcommand。

### Internal

- 移除 `tabtab` 依赖(它的 install 写 ~/.zshrc 太侵入,改自己手写 completion 脚本)。
- 新增 `colors` / `did-you-mean` / `confirm-prompt` / `completion-scripts` /
  `resolve-executable` 等 helper 模块,各自带单测。
- 全套测试 564 项(从 541 → 564),覆盖新 subcommand parser / helper / e2e bug fix。

## [0.7.0] - 2026-05-10

### Breaking changes

- **路径反代取代多端口**：所有外部访问从 `http://lan-ip:port/?token=` 迁移到
  `http://broker:3000/?token=...`（broker 根）或 `http://broker:3000/i/<id>/`
  （进入特定实例）。0.6.x 用户分享的 `?token=` URL 失效，需要重新分享 broker
  入口 URL（用 `atr --status` 获取完整清单）。
- **worker 只听 `127.0.0.1`**：worker 不再向 LAN 暴露端口，只接受 broker 反代
  的 loopback 连接（ADR-009）。`--host 0.0.0.0` / `--host <lan-ip>` 会被
  强制覆盖为 `127.0.0.1` + 一行 warn。
- **API 归属重划分**：所有"系统级"API（auth / config / instances / push /
  share / workdir-policy / SSE）由 broker 持有；worker 仅保留 `/api/health`
  与 `/api/hook`（claude hook，loopback only）+ `/ws`（PTY IO）。前端 fetch
  全部改绝对路径 `/api/*` 直命 broker；零 worker 状态下 webapp 也能完整使用
  （ADR-011）。
- **POST /api/instances 改异步**：返回 202 Accepted + `{ instanceId, status: 'pending' }`，
  worker 自注册后通过 SSE `/api/instances/stream` 推 ready；30s 超时 broker
  主动 SIGTERM 兜底。
- **CLI flag 化**：旧 `atr broker {start,stop,status}` / `atr broker service {install,uninstall,status}`
  / `atr list` 子命令全部删除，改为顶层 flag（必须紧跟 atr，互斥）：
  - `atr --start` / `--stop` / `--status` / `--list` / `--logs` / `--install` / `--uninstall`
- **CLI 输出全英文**：`--help` / `--status` / 错误信息 / banner 全部从中文
  改为简单英文，便于国际化（源码注释保持中文）。
- **cookie 名统一**：从 `session_id_p<port>` 改为 `session_id`（ADR-006）。
  0.7.0 同时识别旧 cookie 名一段时间避免升级即强制重登；0.8.0 删旧识别。
- **session 共享存储**：从进程内 Map 换成 `~/.atr/sessions.json` 文件锁共享；
  多实例共享同一份 session，跨 worker 切换不再要求重新登录。

### Added

- **broker 进程**：所有 worker 启动前自动 fork 一个 broker（ADR-001/002）
  - 监听 `0.0.0.0:3000`（默认；`ATR_BROKER_PORT` 可覆盖）
  - 反代 `/i/<id>/api/*` 与 `/i/<id>/ws` 到对应 worker；`/i/<id>/` 与静态
    资源由 broker 自己服务并注入 `<base href="/i/<id>/">`（ADR-007）
  - 注入 `X-ATR-Forwarded-*` 头 + 标准 `X-Forwarded-Host/Proto/For`（ADR-008）
  - 持有所有"系统级"状态：AuthModule / SessionsStore / InstanceSpawner /
    PushService / ConfigStore（ADR-011）
  - 进程日志按天 rotate，保留 7 天：`~/.atr/broker-YYYY-MM-DD.log`
- **顶层服务 flag**（取代 broker 子命令）：
  - `atr --start`：启动后台服务（前台进程，Ctrl+C 退）
  - `atr --stop`：SIGTERM → 5s 优雅期 → SIGKILL 兜底
  - `atr --status`：一屏看清 5 段 — Service（pid/port/health）/ Autostart
    （systemd/launchd 激活状态）/ Token（含完整值与文件 mode）/ Entry URLs
    （所有可达 URL，默认入口标 ★，每条带 `?token=`）/ Instances（count + 简表）
  - `atr --list`：列实例（取代 `atr list`）
  - `atr --logs`：tail 当天 broker log
  - `atr --install` / `--uninstall`：注册 / 卸载开机自启（ADR-010）
    - Linux/WSL2：`~/.config/systemd/user/atr-broker.service`
    - macOS：`~/Library/LaunchAgents/ke.kkjb.atr-broker.plist`
    - Windows：本版本不支持，0.7.x 跟进
- **Web Push entryUrl**：订阅时记录用户访问入口（broker 端从 X-ATR-Forwarded-*
  反推），推送通知点击跳回正确 host；多设备 / 多反代域名各持各的 url。worker
  端 PushService 在 notifyAll 前 reload 订阅文件，避免 broker 写后内存 stale。
- **SPA 内部路由切实例**：切 tab = `history.pushState('/i/<id>/')`；浏览器
  back/forward 同步 active 实例；F5 刷新 `/i/<id>/` 不丢实例。
- **broker spawn 实例**：POST `/api/instances` 时 broker 预生成 instanceId
  通过 env `ATR_INSTANCE_ID` 透传给 worker，让 webapp 立即可订阅 SSE 等就绪。

### Removed

- `atr broker` 子命令家族（已迁移到顶层 flag）
- `atr list` 子命令（迁移到 `atr --list`）
- worker 端 `/api/auth` / `/api/config` / `/api/instances` / `/api/push` /
  `/api/share` / `/api/workdir-policy`（迁移到 broker）
- worker 端静态资源服务（broker 接管）
- worker `/api/instances/self/shutdown` HTTP 中转（broker DELETE 直接 SIGTERM）
- worker 启动流的 IpMonitor（worker 只听 loopback，IP 变化与 worker 无关）
- 跨 port 实例切换（`location.assign(buildInstanceUrl(host, port))` +
  `?killAfterSwitch=` URL 参数）—— 0.7.0 全 SPA 内同源完成

### Migration

升级 0.6.x → 0.7.0：

1. `npm i -g auvezy-terminal-remote@0.7.0`
2. 之前的 `http://lan-ip:port/?token=` 形式 URL 失效；启动后用 `atr --status`
   查看新的 broker 入口 URL（每条带 token，复制即用）
3. 想让 broker 开机自启：`atr --install`，按提示跑后续命令
4. 旧 `atr broker xxx` / `atr list` 命令报错；改用对应顶层 flag
   （`atr --start` / `atr --status` / `atr --list` 等）
5. 旧 cookie 自动识别一段时间，无需立即重登
6. 自动化脚本：把 `atr broker start` 改成 `atr --start`，`atr broker stop`
   改成 `atr --stop`；如果之前装过 systemd / launchd 服务，建议
   `atr --uninstall && atr --install` 重装（旧 service 文件的 ExecStart
   仍指向 `atr broker start`，0.7.0 起无效）

详细架构与决策请见 `docs/plans/path-routing/`：design.md + design-v2-api-ownership.md
+ 11 个 ADR。

## [0.6.0] - 2026-05-09

### Breaking changes

- **配置体系迁移到 `~/.atr/`**：
  - 主配置：`~/.auvezy/terminal-remote/config.json` → `~/.atrrc`（顶级 dotfile）
  - 内部数据：`~/.auvezy/terminal-remote/{instances,vapid,push-subscriptions,settings}` → `~/.atr/{...}`
  - **不做向后兼容**：升级到 0.6.0 后旧路径会被忽略；用户需手动 `mv` 或重新生成 token
  - 设计：`.atrrc` 走 unix dotfile 惯例（同 `.npmrc` / `.gitconfig`）；`~/.atr/` 是工具内部数据目录

### Added

- **新增实例 Modal 加扫码 / 链接两个远端接入入口**：
  - 主表单下方加分隔线 + "从其它机器接入" section
  - 复用 AuthPage 的 QrScanPane / UrlPastePane 共享组件（按 mixin 一处定义）
  - 扫到 / 输入合法 URL 即跳转该实例（与认证页一致）
- **Workdir 白名单 / 黑名单**（核心安全）：
  - CLI flag `--workdir-allow <patterns>` / `--workdir-deny <patterns>`（picomatch glob，逗号分隔）
  - env `OCR_WORKDIR_ALLOW` / `OCR_WORKDIR_DENY`
  - `~/.atrrc` 字段 `workdirAllow` / `workdirDeny`
  - 优先级：CLI > env > 配置文件 > 默认黑名单
  - 默认黑名单：`/etc/**` `/root/**` `/sys/**` `/proc/**`（用户可在 `~/.atrrc` 显式 `"workdirDeny": []` 清空）
  - 校验在 `instance-spawner` 内 → 所有 spawn 路径（API / 未来 CLI）统一覆盖
- **实例面板主机分组 UI 骨架**：
  - InstanceTabs / MobileInstanceSwitcher 按 host 分组渲染（≥ 2 host 时显示 HostGroupHeader）
  - HostGroupHeader 支持 inline 重命名（铅笔 hover 浮出，Enter 保存 / Esc 取消）
  - 别名持久化到 localStorage（`atr.host_aliases`）
  - 当前单 host 场景视觉无变化；为未来跨主机管理预留架构
- **"创建实例" → "新增实例"措辞调整**（中英文）：避免与"远端接入"语义冲突
- **可热插拔 Integration 抽象层**：
  - `IntegrationManager` + `Integration` 接口；事件类型涵盖 approval / tool / turn / session / userPrompt
  - 默认开启 + auto-detect；设置面板提供总开关 + 识别策略（`auto` / `claude-code` / `none`）
  - 为未来接入 gemini-cli / aider / codex 预留架构，新增模块只需实现 `Integration` 接口
- **Claude Code 集成模块完整实现**：
  - 检测 `claude` 命令自动启用，spawn 时注入 hook settings 把生命周期事件转给 atr
  - 事件覆盖：审批信号 / 工具进度 / turn 生命周期 / session 生命周期 / 用户输入
  - 设置面板提供模块详细设置子 modal（事件级开关）
- **设置面板"集成"tab + StatusBar 富状态展示**：
  - 顶层总开关 + 识别策略；模块卡片：标题 + 蓝色"已激活"状态 + 描述 + 详细设置按钮
  - StatusBar 接收 `SessionStatusExtras`：审批等待中显示工具名、活跃工具、错误信息
- **设置面板"操作"tab 卡片化**：
  - 快捷键 / 命令不再平铺巨大的树形编辑器，改为标题 + 启用计数 + 简短说明 + "详细设置"按钮
  - 点击进入二层 modal 管理具体分组与项；改动随父级"应用"统一保存
- **"开发者选项"tab**：Eruda / Console Bridge 等本设备调试开关

### Changed

- `tagged-template-literal` 风格内联使用 picomatch 进行 glob 匹配，dot:true 让 `.config` 等隐藏目录可被通配符命中
- AuthPage.tsx 从 ~380 行 → ~220 行（抽 QrScanPane + UrlPastePane）
- AuthPage.module.scss 从 ~440 行 → 241 行（用 `_qr-input-mixins.scss` 共享样式）
- **样式系统全量迁移到 CSS 变量**：60+ 设计 token 通过 `:root` 暴露为 `var(--xxx)`，浏览器 DevTools 直接可调；新增 alpha 梯子（accent-04/18/35/40/65、warn/alarm-08/32）取代散落的硬编码 `rgba()`；新增 `--color-on-accent` / `--color-terminal-red` / `--color-bg-elev-solid` 分离独立语义；`phosphor-glow` 改用 CSS 相对颜色 `rgb(from <c> r g b / a)`；44 个 `.module.scss` / 1780 处 `t.$xxx` 替换

### Fixed

- **调色板下拉撑开 sheet body 引发滚动条出现**：`themeList` 改为 `position: absolute` 浮在 trigger 下方；补点击外部 / Esc 关闭
- **设置面板预览字号被滚动条出现/消失影响**：从 `ResizeObserver(预览容器)` 改为 `window.innerWidth` 作为参考宽度，与预览容器的临时尺寸完全脱钩
- **审批状态卡住 bug**：原 `_status` 只被 Notification hook 设为 `waiting_input` 永不清；改为 `pendingApprovals: Map` + PostToolUse/Failure 发 `approval_resolved`，状态从 map 派生

### Removed

- 删未引用的 `createInstance.*` i18n key block（顶层 8 key，全代码库 0 引用）

### Internal

- 新增 `frontend/src/components/auth/QrScanPane.tsx` + `UrlPastePane.tsx`（与 SCSS）
- 新增 `frontend/src/styles/_qr-input-mixins.scss`（扫码 / URL 输入样式 mixin 库）
- 新增 `frontend/src/services/host-aliases.ts`（host alias localStorage）
- 新增 `frontend/src/hooks/useHostGroups.ts`（按 host 分组 + alias 反查）
- 新增 `frontend/src/components/instances/HostGroupHeader.tsx` + scss
- 新增 `backend/src/utils/workdir-policy.ts` + 19 测试用例
- 新增依赖：`picomatch@^4.0.4` + `@types/picomatch`
- shared 包导出 `DEFAULT_WORKDIR_DENY` 默认敏感路径列表

## [0.5.0] - 2026-05-08

### Added

- **认证页扫码登录**：摄像头取景器 + 工业风扫描线动效，扫到合法 http(s) URL
  自动跳转。用 `getUserMedia` + `jsQR` 全平台一致解码，权限拒绝 / 设备无 /
  通用错误三态都有显式提示与 retry。新增 `useQrScanner` hook（独立可复用）。
- **认证页链接登录**：粘贴完整 URL 直接前往。专为"用户清了 localStorage / 跨设备
  首次接入 / 服务重启换 token"等场景的逃生入口。
- **认证页三入口设计**：token / 扫码 / 链接同一张深色卡片内分模式切换，不开
  modal、不引入新层。复用现有"精致工业极客风"设计系统（磷光 accent + Geist Mono +
  100% 直角）。三个入口均 ≥44×44px 满足移动端触摸目标。
- **输入栏长按指示器**：新增 `LongPressIndicator` 圆形进度环，长按时实时反馈
  剩余时间，避免误触；与触摸手势 hook 联动。
- **textarea IME composition guard**：新增 `useTextareaInputGuard` hook，
  iOS / Android 输入法预测输入不再污染 PTY，组合候选词期间隔离传入。
- **设置面板 Actions / Controls 子页**：拆出 `ActionsSettings` 与
  `ControlsSection`，按"操作 / 控制"维度独立配置，原 SettingsModal 路由调整。
- **dev-proxy 自动探活**：vite 端口 5173-5180 范围内自动探测可用端口（10s
  缓存），开发时不再写死端口；`--dev-proxy` 现在支持可选值形式。

### Changed

- **README 极简卡片化**：从 396 行 → 118 行（英）/ 327 行 → 115 行（中）。
  顶部 logo + 4 个 shields.io 徽章 + 居中 desktop.png，9 个 features bullets，
  Roadmap / 完整 CLI / WSL 详情全部沉到 docs/ 子文档。新增中英对称的
  `docs/FEATURES.md` / `ROADMAP.md` / `CLI.md` / `WSL.md` 共 8 个文件。
- **移动端 xterm 内部 API 集中**：抽 `frontend/src/utils/xterm-internals.ts`
  封装内部访问，从分散在 `useTerminal` / `ConsolePage` / `InstanceView` 的
  helper-textarea 焦点劫持、visualViewport 处理等代码集中管理。
- **InputBar 显示层与受控层分离**：避免 iOS 长句子输入时 React state
  re-render 卡顿，DirectInputCapture 重构控制键映射。
- **shared/defaults 默认配置同步**：UserConfig 加新字段 + ensureDefaultUserConfig
  同步 normalize（避免 PUT 进来的字段被 backend GET 时 strip）。

### Removed

- **CLAUDE_COMMAND / CLAUDE_ARGS / CLAUDE_CWD env 兼容已彻底移除**（breaking）。
  这三个旧名 0.4.x 时还会 warn 一次后照常生效，0.5.0 起完全不读取，请改用
  `OCR_COMMAND` / `OCR_ARGS` / `OCR_CWD`。同步删除 `readLegacyEnv` helper +
  对应单测。
- **README "通知"特性宣传**：Web Push / VAPID / iOS LocalNotification 相关
  代码骨架仍在仓库，但端到端流程未走通（需要 HTTPS 链路与订阅 UX 打磨），
  从 README 已实现特性区移除，列入 `docs/ROADMAP.md` Tier 1 第 6 项。

### Internal

- 依赖：新增 `jsqr@1.4.0`（认证页扫码解码器）
- 新增 `frontend/src/hooks/useQrScanner.ts`（独立 hook，可复用到其它页面）
- 新增 `frontend/src/hooks/useTextareaInputGuard.ts`（IME composition 隔离）
- 新增 `frontend/src/utils/xterm-internals.ts`（xterm 内部 API 集中点）
- 新增 `frontend/src/components/input/LongPressIndicator.tsx` + scss
- 新增 `frontend/src/components/settings/ActionsSettings.tsx`
- 新增 `frontend/src/components/settings/ControlsSection.tsx`
- 新增 `docs/code-review-2026-05-08.md`：13 维度全量代码审查报告（架构 /
  可读性 / 复用 / 安全 / i18n / 样式 / 性能 / 错误 / 测试 / 依赖 / 类型 /
  文档 + 汇总），后续版本将按 P0/P1/P2 路线图推进
- 新增 `docs/移动端与桌面端交互设计-2026-05-08.md`
- CLAUDE.md 补 dev server 重启流程章节（WSL 上 tsx watch 不可靠的应对）
- `instance-spawner` 注释修正（cwd 实际由 spawn 选项传，非 env）

## [0.4.5] - 2026-05-07

### Added

- **移动端 swipe 翻方向键**：claude / vim / htop / tmux 等 alt-screen TUI 里
  手指上下滑动 = 发对应数量的方向键序列到 PTY，每 28px ≈ 1 次方向键，垂直分量
  必须 > 水平 1.5 倍才接管（避免误触横向选择）。普通 shell 仍走 xterm 原生
  scrollback 滚动。backend 新增 `alt_screen_change` WS 消息广播 alt-screen 状态。
- **移动端实例详情 modal**：点击实例卡片打开（替代旧的"卡片即切换"），完整展示
  name / cwd / host / port + 4 个动作（切换 / 断开 / 关闭 / 取消）。卡片右侧的
  关闭按钮替换为切换图标，关闭仍由 modal 内的"关闭实例"按钮触发（保留二次确认）。
- **字段值点击复制 + 三档能力降级**：clipboard API（HTTPS）→ execCommand fallback
  （桌面 LAN HTTP）→ select-only 模式（iOS LAN HTTP）。iOS LAN HTTP 下不假装能
  复制，改成"点击 = 选中文本，长按系统拷贝"，避免 execCommand silent fail 误导。
- **关于面板新增使用须知**：4 条易踩坑的非显然行为（关闭浏览器不停 backend / 仅
  LAN+Tailscale / 多设备主控 / 多虚拟网卡选 IP 顺序）。
- **xterm 调色板主题切换**：7 个预设跟 Claude Code `/theme` 命令对齐
  （dark / light / dark-ansi / light-ansi / dark-daltonized / light-daltonized / auto），
  默认 auto 跟随系统亮暗。设置面板"显示"tab 加可折叠下拉，预览 sticky 在顶部。

### Changed

- **iOS 渲染器从 DOM 切到 Canvas**（addon-canvas）：解决 iOS 上行高比桌面松散
  3-5px 的视觉差异。Canvas 与桌面 WebGL 同样按 fontSize × 1.0 自绘，避开 DOM
  renderer 的字体度量歧义；同时绕开 WebGL 在 iOS 的 GPU 上下文丢失 + rAF 限流
  丢帧问题。
- **xterm 调色板默认 Campbell**（Windows Terminal / PowerShell 默认）替代 One Dark：
  跟用户在本地终端跑 PTY 看到的颜色一致，无"远端跟本地不一样"困惑。bright 系
  饱和度更高，移动端小屏更易区分。Campbell 同时是新 `dark` 主题的实现。
- **xterm 字体栈扩展**：英文加 JetBrains Mono / Fira Code / Cascadia Code（用户
  装了就用），中文加 Sarasa Mono SC / Maple Mono CN（社区"中英 1:2 等宽"主流方案），
  绝不让 SimSun / 宋体衬线字体进入 fallback。
- **Sheet 组件加 overlayTone='strong'**：嵌套 modal（详情 modal 叠在外层 sheet 上）
  时背景下层会透出来，strong 模式加深 overlay + 加大模糊半径 + 抬高 z-index。
- **断开按钮黄色 / 关闭按钮红色**：颜色语义跟操作破坏性匹配，断开仅本设备（warning）
  vs 关闭杀 backend（danger）。
- **移动端实例卡片 cwd 完整折行展示**：长路径不再 truncate，所有文字直接可见。

### Fixed

- **日常鉴权失败日志降级到 debug**：之前 `WS upgrade 被鉴权拒绝` / `WS 认证失败：
  无有效 session` / `WS URL token 无效` 等用户日常行为（cookie 过期 / 多 tab 竞争
  / token 改了）就会触发的 warn 日志会污染 PowerShell PTY 终端。已降级到 debug，
  排查时 LOG_LEVEL=debug 仍可看到完整上下文。
- **PTY exit 后客户端写入的预期竞态日志**：`尝试写入 PTY 但进程未运行` 也降到 debug。

### Internal

- 新增 `frontend/src/themes/terminal-themes.ts` 集中管理调色板预设
- 新增 `frontend/src/utils/clipboard.ts` 三档能力检测 + 选中 helper
- 新增 `frontend/src/hooks/useTouchSwipeScroll.ts` 移动端 swipe → 方向键
- 新增 `frontend/src/components/instances/InstanceDetailModal.tsx` 实例详情 sheet
- backend `pty-manager` emit 新事件 `altScreenChange`，session-controller 转发到 WS
- shared `ws-protocol` 加 `AltScreenChangeMessage` 类型，`DisplayPrefs` 加 theme 字段

## [0.4.4] - 2026-05-07

### Changed

- **GitHub 上线为主仓库，Gitee 作国内镜像**：
  - backend `package.json` 的 `homepage` / `repository` / `bugs` 改指
    `https://github.com/jjj201200/auvezy-terminal-remote`，npm 页面右侧
    "Repository" 按钮跳到 GitHub
  - 关于面板"链接"区改为列出 5 项：源码（GitHub）/ 源码（Gitee 镜像）/
    Issues GitHub / Issues Gitee / npm 包页面
  - README "源码方式" 同时给两个 clone URL

## [0.4.3] - 2026-05-07

### Added

- **协议从闭源（UNLICENSED）改为 [PolyForm Noncommercial 1.0.0](./LICENSE)**：
  个人 / 学习 / 非营利组织可自由使用、修改、再分发；商业用途需另外获得授权。
  package.json `license` 字段、README、关于面板的许可说明同步更新。
  backend package.json 补齐 `homepage` / `repository` / `bugs` 字段，npm 页面
  可以点跳到 Gitee 仓库 / Issues。
- **设置面板新增「关于」tab**：版本号、简介、能力列表、使用须知（4 条易踩坑的
  非显然行为）、源码 / npm / issue 链接、许可说明。版本号点击可一键复制（移动端
  长按场景方便贴 issue）。完整 i18n（中 / 英）。版本号由 vite `define` 在构建时
  注入 `__APP_VERSION__`，跟 backend npm 包版本对齐。

### Fixed

- **PowerShell / Windows Terminal 关闭实例后本地终端"空屏卡住"**：根因是
  Windows 上 Node 的 `process.kill('SIGTERM')` 等同于 `TerminateProcess`——目标
  backend 进程**不会触发** `process.on('SIGTERM')` listener，被强杀，没机会还原
  stdin raw mode / 退出 alt-screen / 显示光标。新增 `POST /api/instances/self/shutdown`
  路由（URL token 鉴权），跨实例停止时优先走 HTTP 让目标自己跑完整 shutdown 流程，
  HTTP 失败再 fallback 到 `process.kill`。Linux/Mac 上同样受益（更干净的清理）。
- shutdown 第二段 reset 序列移除 `\x1bc` (RIS hard reset)：在 Windows Terminal /
  PowerShell conhost 上 RIS 会清屏 + 复位光标但不释放 console input mode，加重了
  "空屏"现象。`relay.stop()` 内的 `TERM_RESET_SEQ` 已经覆盖必要的状态，RIS 是冗余。
- POSIX `stty sane` 命令在 Windows 上不存在，原 try/catch 静默吃错但仍 spawn 一次
  失败子进程；改成判 `process.platform !== 'win32'` 才调。
- 0.4.2 引入的 `[detectDisplayIp]` 诊断行**默认关闭**：之前 IpMonitor 每 30s 轮询
  时都打一行到 stderr，污染所有 PTY 终端。现在仅在 `ATR_DEBUG_NETWORK=1` 时输出。

### Changed

- **Windows 默认 shell 升级为 pwsh > powershell.exe > cmd.exe**：之前默认 cmd.exe
  无 readline / 默认关 ANSI，体验落后 30 年。现在按 PATH 自动探测：
  - 用户装了 PowerShell 7（pwsh.exe）→ 用它（跨平台、PSReadLine 内置、ANSI 默认开）
  - 否则用 powershell.exe（5.1，所有 Win 10/11 自带）
  - 都没找到才回退 cmd.exe（实际不可能，powershell.exe 系统级安装）
  
  老用户行为不变：`$SHELL` / `OCR_COMMAND` 环境变量优先级仍最高，显式覆盖照旧。

## [0.4.2] - 2026-05-07

### Added

- `detectDisplayIp` 诊断输出（候选分组 + 最终选取的 IP），方便诊断 displayIp 误选。
  > **注意**：本版本默认开启诊断输出，会污染 PTY 终端，已在 0.4.3 修复。

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
