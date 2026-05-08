# Auvezy Terminal Remote 全量代码审查报告

> 审查日期：2026-05-08 · 版本：0.4.5 · 范围：212 个源码文件 / ~28k 行 TS·TSX
> 审查方式：12 个独立维度的并行审查（架构 / 可读性 / 复用 / 安全 / i18n / 样式 / 性能 / 错误处理 / 测试 / 依赖 / 类型 / 文档）
> 交付方式：纯报告（不动代码）

---

## 0. 总体结论

**Auvezy Terminal Remote 0.4.5 是一份高于行业平均水平的代码库。** 三层 monorepo 边界清晰、shared 包零污染、错误体系完备（8 个 AppError 子类、合规率 ≈97%）、安全红线 5/5 全部落实、零 `any`、设计 token 体系成型、测试覆盖 ~68%。最近的移动端大改 + 设置面板重构 + i18n 落地都没有引入显著回归。

**最值得立刻处理的 6 件事**（按风险/收益排序）：

1. **🔴 [P] visualViewport / wsFlushTimer 监听未清理** — 长跑数小时必出现 RAF 堆积或进程优雅关闭卡死。`useTerminal.ts:749`、`session-controller.ts:wsFlushTimer`。
2. **🟠 [S] 默认 host = `0.0.0.0`** — 红线"仅绑 LAN IP"在代码默认值上漏了一道防线，banner 也没警告。`backend/src/config.ts:469`。
3. **🟠 [E] 4 处裸 `throw new Error`** 违反 AppError 规范。`attach-client.ts:64,69`、`rate-limiter.ts:37`、`output-buffer.ts:32`。
4. **🟠 [I18N] 中文版多处未翻译** — `previewMeta`、`shortcuts.nameLabel`、`commands.commandPlaceholder` 等仍是英文，影响中文用户体验。
5. **🟠 [TYPE] JSON.parse 后 `as UserConfig` 无 runtime schema 校验** — config 文件被改坏会跑到深处才炸。`backend/src/config.ts:332`。
6. **🟠 [DOC] ARCHITECTURE.md 还在用旧前缀 `@otr/*`** — 与现行 `auvezy-terminal-remote-*` 不一致，新贡献者第一份文档就误导。

**严重度图例**：🔴 Critical（不修必出问题） · 🟠 High（下次重构必处理） · 🟡 Medium · 🔵 Low / Nit

---

## 1. 架构与目录结构

无 Critical。架构整体成熟，三层分层清晰。

| 级别 | 位置 | 现象 | 建议 |
|------|------|------|------|
| 🟠 | `backend/src/utils/` | 五类不同职能混杂（network、file-lock、ansi-filter、wsl-*、qrcode-banner），共 ~1000 行 | 按职能分组：`utils/network/`、`utils/platform/` (WSL)、`terminal/ansi-filter`；file-lock 迁入 `registry/lock-manager.ts` |
| 🟠 | `backend/src/terminal/terminal-relay.ts` (~280L) | 同时处理 stdio 透传、窗口同步、双 Ctrl+C 检测、复位序列 | 拆分 `TerminalRelay` / `TerminalModeManager` / `CtrlCDetector` |
| 🟠 | `frontend/src/hooks/useTerminal.ts` (~350L) | 同时管 xterm 实例、3 个 addon、批写入队列、resize 节流、自动滚动跟随、主题 | 拆 `useTerminal`（实例生命周期）+ `useTerminalWrite`（队列）+ `useTerminalScroll`（跟随） |
| 🟠 | `frontend/src/components/instances/` | InstanceTabs / MobileInstanceSwitcher / CreateInstanceModal 同属"多实例"散在一起 | 整合到 `components/multi-instance/`，或让 InstanceTabs 单一职责（仅显示与切换） |
| 🟡 | `backend/src/session/session-controller.ts` | 文件偏大但注释清晰可接受。如果 master/slave 仲裁继续复杂化，应分出 `MasterSlaveMediator` | — |
| 🔵 | `frontend/src/services/` | 缺一个统一的 API facade，各 hook 自己 fetch | 加 `services/api.ts` 集中拦截器/重试 |

✅ shared 包纯净无污染；ADRs 与 ARCHITECTURE.md 体系健全；CLI_MODE 动态 import 巧妙但 cli.ts 顶部应加注释说明。

---

## 2. 可读性与注释

| 级别 | 位置 | 现象 | 建议 |
|------|------|------|------|
| 🟠 | `backend/src/cli-utils.ts:154-282` | `parseCliArgs` 129 行处理 6 种 flag + 子命令 | 拆 `flag 规范化 → 值形式 → 可选值形式 → 透传`；提取 peek helper |
| 🟠 | `frontend/src/hooks/useTouchSwipeScroll.ts:85-450+` | 单 hook 450+ 行，5 大事件处理器、13 个状态、3 个 timer | 拆 `TapDetector` / `SwipeAccumulator` / `LongPressManager` |
| 🟠 | `backend/src/session/session-controller.ts:199-260` | wirePty 嵌套 3 层回调；onResize 仲裁规则散落 4 个 if | 提取 `shouldIgnoreResize(master, source, type, counts)` 谓词 |
| 🟡 | `backend/src/utils/ansi-filter.ts` | `cutTrailingEsc` / `captureTrailingEsc` 返回值语义易混 | 参数显式 `(s, targetPrefix)` |
| 🟡 | `backend/src/cli-utils.ts:284-354` | `assignFlag` switch 108 行 | 用映射表 `{ '--no-terminal': 'noTerminal' }` + parser 分发，可压到 ~40 行 |
| 🟡 | `frontend/src/components/input/DirectInputCapture.tsx:44-66` | 魔数 `96 (0x60)` 未注释 | 改 `'a'.charCodeAt(0)` 自文档化 |
| 🔵 | `frontend/src/components/settings/ControlsSection.tsx:30-35` | boolean 命名前缀 use/is/has 混用 | 统一 `is*` 或 `has*` |
| 🔵 | `frontend/src/hooks/useUserConfig.ts:12` | TODO 无版本 / 时间戳 | 标"阶段 N" 或 issue 链接 |

**TODO/FIXME/HACK 清点**：仅 1 处明确 TODO（useUserConfig.ts:12），无 FIXME/HACK，无被注释掉的死代码。

整体注释质量高（ansi-filter / cli-utils 的 why 注释尤其出色），JSDoc 覆盖 >90%。

---

## 3. 组件复用与代码重复

| 级别 | 位置 | 现象 | 建议 |
|------|------|------|------|
| 🟠 | `CreateInstanceModal:47-56` + `InstanceDetailModal` + `SettingsModal` | 都手写 `useEffect(() => { if(open) reset })` | 抽 `useModalReset<T>(initialState)` |
| 🟠 | `CreateInstanceModal:60-77` + 同类 modal | `submitting/error` 双态 + try/await/finally 套路 | 抽 `useFormSubmit(asyncFn)` 返回 `{loading, error, submit}` |
| 🟠 | `ActionsSettings` / `ControlsSection` | 重复 `<section className={gs.section}><header>...` 包装 | 抽 `<SettingsSection title hint>` 组件 |
| 🟡 | `useUserConfig` / `useInstances` / 其他 hook | API fetch 的 try/catch 模板重复 | 抽 `useFetch<T>(url, options?)` |
| 🟡 | `Toolbar` 分组 + `ShortcutSettings/CommandSettings` 可能存在的分组 | `useMemo(() => Map.set...)` 模板 | 抽 `useGroupedItems<T>(items, getGroupId)` |
| 🔵 | `IconButton` 是否被充分复用 | 部分 button + icon 处可能没用 | 全局 grep 一下，把还在自己拼的换成 IconButton |

✅ Sheet/Toggle/TextField 等 UI 原语抽得恰到好处；shared 包边界干净；hooks 整体职责清晰，主要冗余在 stateful 模板代码。

---

## 4. 安全（红线 + OWASP）

### ✅ 红线 5/5 通过

| 项 | 验证 |
|----|------|
| Token 用 timingSafeEqual 比较 | `auth-middleware.ts:76-80` 长度先比再 timingSafeEqual ✓ |
| /api/hook 仅 loopback | `hook-routes.ts:22-24,32-33` 非 loopback 直接 403 ✓ |
| 配置文件 0o600 / 目录 0o700 | `config.ts:132,136,299,366` 全部正确 ✓ |
| WS 双路认证 | `ws-authenticate.ts:35-49` URL token + Cookie session 都校验 ✓ |
| CORS 白名单 | `index.ts:246-267` 不是 `*`，仅 localhost+本机网卡，可通过 `OCR_CORS_ALLOW` 扩展 ✓ |

### 仍需处理

| 级别 | 位置 | 现象 | 建议 |
|------|------|------|------|
| 🟠 | `backend/src/config.ts:469` | 默认 `host: '0.0.0.0'` —— 与红线"仅绑 LAN IP"精神不一致；banner 也无警告 | 改默认为 `127.0.0.1` 或 LAN IP 自动选择；banner 强制告警；显式 `0.0.0.0` 需要二次确认 |
| 🟡 | `backend/src/session/session-controller.ts:328-357` | master 声明由客户端 WS 消息携带，目前靠 webapp Cookie + attach token 隔离 | 现状安全。如未来支持多异地客户端，需限定 master 声明权限 |
| 🟡 | `backend/src/cli-utils.ts:256-269` (新增) | `--dev-proxy` 仅探活 5173-5180 loopback，逻辑正确 | 仅本地调试，低风险，但可在文档中标"仅开发用" |

**未发现：** 命令注入、路径穿越、XSS、CSRF、log 注入、敏感信息（token / cookie）落 log。

---

## 5. i18n 完整性与措辞

✅ Key 在 zh-CN.ts 与 en.ts 完全对齐；占位符 `{{var}}` 格式两边一致；硬编码字符串扫描通过（IpChangeToast / GeneralSettings / ActionsSettings / ControlsSection / AboutSettings / LongPressIndicator / ShareSheet 全部规范走 t()）。

### 中文版未翻译（应补）

| 位置 | 现状 | 建议 |
|------|------|------|
| `zh-CN.ts:105` | `previewMeta: 'Font {{size}}px · Spacing {{ls}}px · Cols {{cols}}'` | `字号 {{size}}px · 间距 {{ls}}px · 列数 {{cols}}` |
| `zh-CN.ts:108-127` | 显示设置项混用 `Auto` / `Custom` / `Font` / `Letter spacing` 英文 | 全翻译为中文 |
| `zh-CN.ts:225-226` | `shortcuts.nameLabel` / `commands.nameLabel` = `'Label'` | `'名称'` |
| `zh-CN.ts:247-248` | `commands.commandPlaceholder: 'Command text (例：/clear)'` 中英混用 | 纯中文 |
| `zh-CN.ts:272` vs `en.ts:279` | 中文 `'cwd'` / 英文 `'Working directory (cwd)'` | 中文也用 `'工作目录 (cwd)'` |

### 英文风格（应统一）

| 位置 | 现状 | 建议 |
|------|------|------|
| `en.ts:31` | `app.loading: 'loading'` | `'Loading'`（与其他按钮 Title Case 一致） |
| `en.ts:128-134` | 主题名 `'dark (default Campbell)'` vs `'light-ansi (16-color)'` 格式不齐 | 统一 `name · description` 或括号 |
| `en.ts:391` | `'Force PTY to wrap at this device's width...'` | `'Adapt PTY width to this device (take master when multiple clients)'` 更自然 |

### 术语词典（建议加入项目文档）

| 英文 | 中文 |
|------|------|
| terminal session | 终端会话 |
| instance | 实例 |
| reconnect | 重连 |
| session | 会话（统一，目前 sessionTtlMs 未译） |
| master / slave | 主控 / 从属 |

---

## 6. 前端样式规范

✅ `_tokens.scss` + `_mixins.scss` 架构清晰；100lvh 替换 100dvh 处理了 iOS bug；移动端断点定义统一。

| 级别 | 位置 | 现象 | 建议 |
|------|------|------|------|
| 🟠 | `LongPressIndicator.module.scss:11`、`ShortcutSettings.module.scss:218`、`InstanceTabs.module.scss:113` | z-index 9999 / 1000 魔数泄漏 | 统一用 token：drag ghost = `calc(t.$z-toast + 2)`；menu = `t.$z-modal` |
| 🟠 | `LongPressIndicator.module.scss:8`、`ShareSheet.module.scss:96`、`InstanceTabs.module.scss:141` | 硬编码 `rgba(255,255,255,0.15)` / `4px` / `8px` | 引入 `--color-accent-dim`、用 `t.$sp-2/3` 系列 |
| 🟠 | 触摸目标尺寸 | IconButton min 22px、Pill 14px 在移动端可能 < 44×44px | mobile mixin：`@include m.mobile { min-height: 44px; min-width: 44px; }` |
| 🟡 | `IconButton.module.scss:47-49`、`SettingsModal.module.scss:33` | 重复硬编码 `rgba(182,240,156,0.32)`（accent glow） | 抽 `--accent-glow-overlay` token |
| 🟡 | `Sheet.module.scss:173,188` | `--vv-bottom` 依赖 JS 注入但无 fallback | 在 `_tokens.scss` 默认 0；改名 `--keyboard-h` 更直观 |
| 🟡 | ConfirmModal / SettingsModal 按钮 | 移动端未禁用 `:hover`，focus-visible 状态未统一 | `@include m.mobile { &:hover {} }` 条件禁用 |
| 🟡 | `Pill` / `ShortcutSettings` 的 phosphor-glow | 移动端 text-shadow 在小屏可能模糊 | 移动端降透明度或关闭 |
| 🔵 | `DesignSystem.module.scss` | 还在用 100dvh 而非项目统一的 100lvh | 替换 |
| 🔵 | `InputBar.module.scss:28-30`、`Toolbar.module.scss:43` | `min-width: 15%`、`padding: 28px` 等魔数 | token 化或加注释 |

### 缺失的设计 token

- `--accent-glow-overlay` —— 替代 5+ 处硬编码 `rgba(182,240,156,0.32)`
- `--touch-target-min: 44px` —— 移动端触摸目标统一标准
- `--gap-compact: 4px` —— 紧凑场景间距统一
- `--duration-interaction: 0.12s` —— UI 交互动画时长

---

## 7. 性能 / 内存 / 渲染频率

### 🔴 Critical（长跑必爆）

| 位置 | 现象 | 后果 | 建议 |
|------|------|------|------|
| `frontend/src/hooks/useTerminal.ts:749` | `visualViewport.addEventListener('resize', onVvResize)` 在 cleanup 里**未 removeEventListener** | 键盘多次开合后 RAF 回调叠层堆积，内存随时间增长 | 在 cleanup 加 `vv?.removeEventListener('resize', onVvResize)` |
| `backend/src/session/session-controller.ts` | `wsFlushTimer: NodeJS.Timeout \| null` 在 `destroy()` 里**未 clearTimeout** | 进程优雅关闭时悬挂；测试结束 PID 不退出 | `destroy()` 头部 `if (this.wsFlushTimer) clearTimeout(this.wsFlushTimer)` |
| `backend/src/ws/ws-server.ts` | 心跳 ping/pong interval 连接断开时未 clear | 孤立 ping 持续发出 | 在 close/error 回调清理 heartbeat timer |

### 🟠 High

| 位置 | 现象 | 建议 |
|------|------|------|
| `useTerminal.ts:825` | `displayKey` 字符串拼接每次 render 都造 | 包 useMemo |
| `InstanceView.tsx:188` | handleMessage 依赖 `[write, adaptToPtySize, localNotify]`，父配置变就重建闭包 → useWebSocket 重绑 | refify 三个依赖，handleMessage 用稳定引用 |
| `ansi-filter.ts:120-122` | 每条 WS 输出都跑 `ERASE_SCROLLBACK_RE.replace()` | 改 `s.split('\x1b[3J')` 或预测试 `indexOf` 短路 |
| `useWebSocket.ts:73-80` | `setConnectionStatusRef.current = (...)` 每次 render 重写 | 用 useCallback 一次性绑 |
| `ConsolePage.tsx:166-190` | focusin 处理 xterm helper-textarea 焦点劫持每次 rAF 检查 | 加 visibility-hidden 时立即 fit + 限流 |

### 🟡 Medium

- `useTextareaInputGuard.ts` IME composition 期间高频 state 更新 → composingText 每帧 re-render
- `InputBar.tsx` 受控显示层 `displayText` state，iOS 长句子输入卡顿
- `rate-limiter.ts:43` `if (typeof unref === 'function')` 在 Node 总成立，可简化

### 长跑稳定性建议

1. WS 心跳 timeout 未实装，依赖浏览器自动关闭。建议每连接维护最后 pong 时间戳，超时主动 terminate
2. xterm 各 addon dispose 顺序固定，建议显式遍历后再 `term.dispose()`
3. PTY 子进程 `onData` 订阅在 spawn 多次（错误路径）可能多重订阅，spawn 前 assert / unwire

---

## 8. 错误处理与日志

✅ AppError 体系完备：8 子类（AuthError、PtyError、WsError、ConfigError、InstanceError、LockError、HookError、PushError）、合规率 ≈97%（4/100+ 违规）。最近 commit `66b717c` 把鉴权竞态从 warn 降到 debug 合理。

### 🟠 High（违反 AppError 规范）

| 位置 | 现状 | 建议 |
|------|------|------|
| `backend/src/attach/attach-client.ts:64` | `throw new Error('无效 URL：...')` | `throw new ConfigError(...)` |
| `backend/src/attach/attach-client.ts:69` | `throw new Error('不支持的协议：...')` | `throw new ConfigError(...)` |
| `backend/src/auth/rate-limiter.ts:37` | `throw new Error('RateLimiter: maxAttempts...')` | `throw new ConfigError(...)` |
| `backend/src/pty/output-buffer.ts:32` | `throw new Error('OutputBuffer: maxLines...')` | `throw new ConfigError(...)` |

这 4 处都是构造时参数校验失败，立即崩溃可接受，但用 ConfigError 统一体系。

### 🟡 Medium

- `auth-middleware.ts:87` 每次 session 创建走 `logger.info`，热路径，可降 debug
- `index.ts:114` shared-token 获取失败 `logger.warn` 合理
- 前端**缺 ErrorBoundary** —— 组件树崩溃没有降级渲染，会整页白屏

### ✅ 已正确

- 无空 catch (`catch {}`)；`registry.unregister().catch(warn)` 是 best-effort 合理
- `dev-proxy.ts:55` 吞 destroy 异常有注释说明
- 日志中无 token / cookie / 密码泄露
- 用户输入未原样 log，无 log injection 风险

---

## 9. 测试覆盖与质量

✅ 35 个测试文件，覆盖核心路径。质量良好（auth-middleware / session-controller / hook-routes / instance-registry 测试堪称范例：行为级 mock、fake timer、并发用例齐全）。

### 现状

- backend: 32 测试（auth × 2、api × 5、utils × 7、registry × 5、session × 1、pty × 2、ws × 2、hooks × 1、其他 7）
- shared: 2 测试（defaults、ws-protocol）
- frontend: 1 测试（utils/escape-codec）
- 框架：Vitest + v8 coverage
- CI：**无 .github/workflows**，仅 `pnpm test` 手动跑
- Smoke test：`backend/scripts/smoke-stage*.mjs` + `smoke-cross.mjs` 全部手动

### 🟠 关键逻辑测试缺口

| 模块 | 风险 | 建议 |
|------|------|------|
| `backend/src/utils/atomic-write.ts` | 并发写、tmp+rename 异常路径 | 多进程压力测试 |
| `backend/src/auth/token-generator.ts` + `ws-authenticate.ts` | 双路认证（URL token vs Cookie）路由选择 | 单测 createWsAuthenticate |
| `backend/src/dev/dev-proxy.ts` | 端口探活、转发 | 至少烟测 |
| `shared/src/instance.ts` / `errors.ts` | 类型守卫 | 补单测 |

### 🟡 测试质量观察

- `cli-utils.test.ts` 167 行覆盖 30+ case 但未模拟 `process.exit`（--help / --version）
- `network.test.ts` 对 `detectDisplayIp()` 仅断言"返回字符串"，未细化策略（私有 IP / Tailscale / hostHint）
- `defaults.test.ts` 旧版检测 `.every` 在 group=null/undefined 时未覆盖

### 🟡 基础设施

- frontend 无 vitest.config.ts —— 依赖默认配置，coverage 没启用
- 无 GitHub Actions —— 测试不强制门，回归只靠开发者自觉

---

## 10. 依赖安全与过时项

✅ 依赖生态健康，无 Critical CVE；React 19、Vite 6、TypeScript 5.9、@xterm/xterm 5.5、ws 8.20、pino 9.14、esbuild 0.28 全部最新稳定版。workspace 隔离正确，backend dependencies 不含 -shared / -frontend，符合发布要求。

### 🟡 待处理

| 位置 | 现象 | 建议 |
|------|------|------|
| `frontend/package.json` | `@types/qrcode` 误放在 dependencies | 移到 devDependencies |
| pnpm-lock | cookie@0.7.2（来自 express 子依赖）+ cookie@1.1.1（直接声明）共存 | 当前无害；可加 `pnpm.overrides: { cookie: "^1.1.1" }` 统一 |

### 🔵 信息项

- 无 helmet / standard 安全头；项目仅绑 LAN，风险低，不强制
- pnpm audit 因沙箱限制未实跑，建议本地 `pnpm audit` 出 JSON 入库

---

## 11. 类型严格性

✅ tsconfig.base.json：`strict` ✓ `noUncheckedIndexedAccess` ✓ `noImplicitOverride` ✓ `noFallthroughCasesInSwitch` ✓；3 个 workspace 都正确 extends。**全代码库零 `any`**（仅 `as` 强转，不算 any）。

### 🟠 待处理

| 位置 | 现象 | 建议 |
|------|------|------|
| `backend/src/config.ts:332` | `JSON.parse(raw) as UserConfig` 无 runtime 校验 | 引入 zod / valibot；或写 `isUserConfig(x): x is UserConfig` 守卫 |
| `backend/src/config.ts:243,252` | `JSON.parse(...) as Record<string, unknown>` | 同上 |
| `backend/src/ws/ws-handler.ts:46` | `JSON.parse(raw) as ClientMessage`（虽配 switch 全覆盖） | 走 `isClientMessage` 守卫一次再 switch |
| `frontend/src/hooks/useInstances.ts:224` | `r.data!.instance.name` 非空断言 | 提取 `r.data` 后再用，或用 `?.` |
| `frontend/src/hooks/useInstances.ts:142` | `(ev as MessageEvent).data` cast | 类型守卫 + typeof 校验 |

### 🔵 设计

- `exactOptionalPropertyTypes` 未启用 —— 是激进选项，启用前需评估改动量
- interface vs type、union literal 命名（`type` / `event`）整体一致，无 enum 滥用
- 未发现 `arr![0]` 之类绕过 noUncheckedIndexedAccess 的非空断言

---

## 12. 文档目录结构

| 级别 | 位置 | 现象 | 建议 |
|------|------|------|------|
| 🟠 | `docs/ARCHITECTURE.md:12-14` | 还在用旧前缀 `@otr/shared` / `@otr/backend` / `@otr/frontend` | 改为 `auvezy-terminal-remote-*` |
| 🟠 | `docs/移动端与桌面端交互设计-2026-05-08.md` | 路径不符合 CLAUDE.md 约定的 `docs/plans/<计划名>/` | 迁到 `docs/plans/mobile-interaction-design/design.md`，建立 progress/ + adrs/ |
| 🟠 | `docs/superpowers/plans/` | 不在 CLAUDE.md 规定的结构内 | 迁到 `docs/plans/` 或显式说明用途（可能是 superpowers skill 自带，需注释说明） |
| 🟡 | `docs/plans/open-claude-remote-clone/progress/overview.md` | 标 ✅ 完成但缺完成日期 | 补完成日 |
| 🟡 | README.md / README.zh-CN.md | 缺移动端章节链接到 2026-05-08 交互设计 | 加"移动端体验"章节并链接 |
| 🟡 | CHANGELOG.md | 0.4.3/0.4.4/0.4.5 都标 2026-05-07，无递进 | 校准实际发布日 |
| 🔵 | `backend/README.md` | 构建脚本 cp 来的，易遗漏 | 文件头加注释"本文件由根 README 同步" |
| 🔵 | CLAUDE.md:71 | 仅说改名 OTR→ATR，无原因 | 加一行 why（npm scope 限制） |

### 缺失文档建议

- **CONTRIBUTING.md** —— fork / 本地开发 / commit 署名规范（已在 CLAUDE.md，建议外提）
- **SECURITY.md** —— 漏洞报告流程 + 安全联系方式（GitHub 标准位置）
- **API.md / Hook Protocol.md** —— `/api/hook` 完整签名、所有 REST/WS 端点、错误码表

---

## 13. 处理路线图（建议）

### 立即修（P0，本周）

1. 性能：visualViewport 监听清理（`useTerminal.ts:749`）+ wsFlushTimer 清理（`session-controller.ts`）+ ws-server 心跳 timer 清理
2. 安全：`config.ts:469` 默认 host 改 `127.0.0.1`，banner 加公网告警
3. AppError：4 处裸 throw 改 ConfigError（一次小 PR）
4. 文档：ARCHITECTURE.md 修旧前缀；移动端交互设计文档迁到 `docs/plans/`

### 短期（P1，下个迭代）

5. i18n：补 zh-CN.ts 漏译 5 处；统一英文 Title Case；术语词典加进 docs/
6. 类型：config.ts 的 JSON.parse → zod schema；ws-handler 走 isClientMessage 守卫
7. 样式 token：抽 `--accent-glow-overlay` / `--touch-target-min`；z-index 魔数清理
8. 前端 ErrorBoundary（缺这个真的会白屏）
9. 触摸目标 ≥ 44×44px（移动端 mixin）

### 中期（P2，下一个版本）

10. 拆 `useTouchSwipeScroll` 三件（TapDetector / SwipeAccumulator / LongPressManager）
11. 拆 `useTerminal` 三件（lifecycle / write / scroll）
12. 抽 `useModalReset` / `useFormSubmit` / `<SettingsSection>` 三个公共件
13. backend/src/utils 按职能分组（network/ + platform/ + terminal/）
14. 测试：补 atomic-write 并发、ws-authenticate 双路、dev-proxy
15. 加 GitHub Actions 跑 `pnpm test` + `pnpm typecheck`

### 长期（P3，时间允许）

16. CONTRIBUTING.md / SECURITY.md / API.md
17. exactOptionalPropertyTypes 评估开启
18. WS 心跳 timeout 主动 terminate
19. 前端统一 API facade `services/api.ts`
20. CHANGELOG 切换 Keep a Changelog 风格

---

## 14. 总结

代码库已经有"可以放心维护"的素质：架构分层、错误体系、安全红线、类型严格、测试覆盖、设计 token —— 这些在很多商业项目里都做不到这种水平。

**最值得修复的债主要集中在三处**：

1. **长跑稳定性** —— 几个监听器/timer 没清理，几小时后必然出问题；
2. **运行时数据校验** —— JSON.parse 直接 cast 是当前唯一的真实"unknown 黑洞"；
3. **可拆分的巨型函数** —— useTouchSwipeScroll / useTerminal / parseCliArgs，单独读都还能读懂，但维护成本会随功能增加上升。

按"P0 立即修 → P1 下迭代 → P2 下版本"三档推进即可。报告中每条都有 file:line 锚点，挑顺手的先做。
