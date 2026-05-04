# 阶段 4 进度：配置体系

## 目标

把启动期的环境变量与运行期的用户偏好统一起来：

- CLI > 环境变量 > config.json > 默认值 四层优先级
- UserConfig（all optional，文件层）vs AppConfig（all required，运行时）
- 前端通过 GET/PUT /api/config 读写偏好（shortcuts / commands）
- 设置页支持启用/禁用、增删（拖拽排序留待后续）

## 验收标准

- [x] `claude-remote --port 3001 --workdir ~/code/foo` 能覆盖默认值
- [x] 环境变量 PORT / AUTH_TOKEN / CLAUDE_COMMAND 仍然有效（向下兼容阶段 2/3）
- [x] ~/.claude-remote/config.json 不存在 → 自动创建并写入默认 shortcuts/commands
- [x] ~/.claude-remote/config.json 字段缺失 → API 返回时由 ensureDefaultUserConfig 兜底
- [x] ~/.claude-remote/config.json JSON 解析失败 → 备份 .corrupted-<ts> 并落默认
- [x] GET /api/config 返回完整 UserConfig（带默认补齐）
- [x] PUT /api/config 写文件 + 立即返回新值
- [x] 前端 SettingsModal 可启用/禁用 shortcut/command；保存后刷新 InputBar
- [x] ConsolePage 顶部菜单按钮打开 SettingsModal

## 步骤清单

- [x] **4.1** shared/defaults.ts 复核 + 类型可序列化检查（UserConfig + ensureDefaultUserConfig + 7 单测）
- [x] **4.2** backend/cli-utils.ts（参数解析）+ 16 单测
- [x] **4.3** backend/config.ts 扩展：UserConfig / AppConfig / loadConfig / ensureDefaultUserConfig + 21 单测
- [x] **4.4** backend/api/config-routes.ts（GET/PUT /api/config，requireAuth）+ 6 单测
- [x] **4.5** router 注入 config-routes
- [x] **4.6** cli.ts 接 cli-utils；index.ts 接 loadConfig（替换原环境变量直读）
- [x] **4.7** frontend hooks/useUserConfig + services/config-api.ts
- [x] **4.8** frontend components/settings/SettingsModal 骨架
- [x] **4.9** ShortcutSettings + CommandSettings 子页（启用/禁用 + 文本输入 + 增删）
- [x] **4.10** ConsolePage 接 SettingsModal + InputBar 读 useUserConfig（含快捷键栏渲染）
- [x] **4.11** 阶段 4 端到端 smoke + 收尾

## 实施日志

### 4.1 shared/defaults.ts
- shared/src/defaults.ts 新增 UserConfig 接口（all optional）
- 新增 ensureDefaultUserConfig：null/undefined / 空数组 / 类型不对 → 默认；
  保留额外字段（如 fontScale）；用户值优先
- 7 个单测覆盖默认值结构、空数组兜底、类型脏数据保护

### 4.2 cli-utils
- 自实现的 argv 解析（不引入 yargs）
- 子命令：start（默认）/ attach <url> / stop / list；attach 后续阶段才实施
- 选项：port/host/token/workdir/config/instance-name/max-buffer-lines/
  session-ttl/auth-rate-limit/log-dir/no-terminal/no-color/no-open/help/version
- "--" 之后全部进 claudeArgs（含以 -- 开头的）
- 未知参数立即 ConfigError，避免静默忽略拼写错误
- 16 个单测

### 4.3 config.ts 扩展
- LoadedUserConfig + loadUserConfig：
  - 文件不存在 → 写默认 + created=true
  - JSON 损坏 → 备份 .corrupted-<ts> + 落默认 + recovered=true
  - 解析成功 → ensureDefaultUserConfig 兜底缺失字段
  - IO/parse 错误一律吞，绝不阻塞启动
- saveUserConfig：tmp + rename 原子写入，失败抛 ConfigError
- AppConfig（all required）+ loadConfig：
  - CLI > env > 默认；token 三级 cli/env/generated
  - 注入式 generateToken / loadUser 便于单测
- 9 个单测覆盖各路径

### 4.4 config-routes
- ConfigStore 接口（get/set），用于把 AppConfig 中的 userConfig 暴露给路由层
  而不泄露 token 等敏感字段
- GET /api/config：requireAuth + 返回经 ensureDefaultUserConfig 兜底的配置
- PUT /api/config：requireAuth + 整体替换 + 字段类型校验
- 写入失败时透传 ConfigError 的 httpStatus 与 code
- 6 个集成单测

### 4.5 router 注入
- router.ts 增加 configStore? option，存在且 authModule 存在时挂 /config

### 4.6 cli.ts + index.ts 接 loadConfig
- cli.ts 动态 import parseCliArgs，处理 --help/--version/子命令分发
- attach/stop/list 暂未实现的子命令显式提示退出 2
- index.ts startServer 接 ParsedCliArgs，调用 loadConfig 一次性合并
- 引入 ConfigStore：内存版 userConfig 与 saveUserConfig 对接
- createApiRouter 注入 configStore
- banner 文案 → 阶段 4

### 4.7 useUserConfig
- api-client：新增 apiPut 包装
- services/config-api.ts：fetchUserConfig / saveUserConfigRemote
- hooks/useUserConfig：
  - 首次挂载 fetch；同时用 localStorage 缓存兜底 InputBar 闪烁
  - save(value) PUT 整体替换；返回是否成功
  - 用 ensureDefaultUserConfig 保证 UI 永远拿到完整 shortcuts/commands

### 4.8 SettingsModal
- 覆盖屏幕的 modal，含 快捷键 / 命令 两个 tab
- 本地草稿编辑模型（draft），保存按钮触发 onSave
- 点背景关闭；每次重新打开把 draft 重置为最新值

### 4.9 ShortcutSettings + CommandSettings
- ShortcutSettings：行式编辑 label / data / 启用 + 新增 + 删除
- CommandSettings：同上 + autoSend 复选框
- 不做拖拽排序（@dnd-kit 留待后续）
- global.css 补 settings-modal__* / settings-list / settings-row /
  input-bar__shortcuts / input-bar__settings 样式

### 4.10 ConsolePage 接 SettingsModal
- InputBar：顶部新增快捷键栏（仅渲染 enabled），点击直接 send
- InputBar 末尾「⚙ 设置」按钮触发 onOpenSettings
- ConsolePage 接入 useUserConfig + 维护 settingsOpen state，挂 SettingsModal

### 4.11 阶段收尾
- backend/scripts/smoke-stage4.mjs：把 HOME 重定向到 tmpdir 隔离副作用，
  自动起 backend → 健康检查轮询 → 8 项验收：
  1) backend 起来 → /api/health 200
  2) /api/auth 200 + Cookie
  3) tmpHome/.claude-remote/config.json 自动生成
  4) GET /api/config 返回 8 个默认 shortcut
  5) PUT /api/config 整体替换 fontScale + 自定义 shortcut
  6) 再 GET 反映新值
  7) 文件层 config.json fontScale=1.25 落盘正确
  8) PUT 非法 body → 400
- 180 backend 单测 + 15 shared 单测 + 6 frontend 静态类型检查全过
- 端口 / 临时目录已清理

## 当前阻塞

无。

## 验证结果

- ✅ 全量 typecheck（backend + frontend + shared）干净
- ✅ 全量单测：180 backend + 15 shared 通过
- ✅ stage-04 smoke 8/8 通过
- ✅ 资源清理（端口 / tmp 目录）
