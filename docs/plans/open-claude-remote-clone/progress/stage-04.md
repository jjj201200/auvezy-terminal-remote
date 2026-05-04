# 阶段 4 进度：配置体系

## 目标

把启动期的环境变量与运行期的用户偏好统一起来：

- CLI > 环境变量 > config.json > 默认值 四层优先级
- UserConfig（all optional，文件层）vs AppConfig（all required，运行时）
- 前端通过 GET/PUT /api/config 读写偏好（shortcuts / commands）
- 设置页支持启用/禁用、增删、可排序（@dnd-kit 在阶段 4 仅做最小可用）

## 验收标准

- `claude-remote --port 3001 --workdir ~/code/foo` 能覆盖默认值
- 环境变量 PORT / AUTH_TOKEN / CLAUDE_COMMAND 仍然有效（向下兼容阶段 2/3）
- ~/.claude-remote/config.json 不存在 → 自动创建并写入默认 shortcuts/commands
- ~/.claude-remote/config.json 字段缺失 → API 返回时由 ensureDefaultUserConfig 兜底
- ~/.claude-remote/config.json JSON 解析失败 → 备份 .corrupted-<ts> 并落默认
- GET /api/config 返回完整 UserConfig（带默认补齐）
- PUT /api/config 写文件 + 立即返回新值
- 前端 SettingsModal 可启用/禁用 shortcut/command；保存后刷新 InputBar
- ConsolePage 顶部菜单按钮打开 SettingsModal

## 步骤清单

- [ ] **4.1** shared/defaults.ts 复核 + 类型可序列化检查
- [ ] **4.2** backend/cli-utils.ts（参数解析：`--port` `--token` `--workdir` `--no-terminal` 等）+ 单测
- [ ] **4.3** backend/config.ts 扩展：UserConfig / AppConfig / loadConfig / ensureDefaultUserConfig + 单测
- [ ] **4.4** backend/api/config-routes.ts（GET/PUT /api/config，requireAuth）+ 单测
- [ ] **4.5** router 注入 config-routes
- [ ] **4.6** cli.ts 接 cli-utils；index.ts 接 loadConfig（替换原环境变量直读）
- [ ] **4.7** frontend hooks/useUserConfig（fetch + 本地缓存）+ services/config-api.ts
- [ ] **4.8** frontend components/settings/SettingsModal 骨架
- [ ] **4.9** ShortcutSettings + CommandSettings 子页（启用/禁用 + 文本输入）
- [ ] **4.10** ConsolePage 接 SettingsModal + InputBar 读 useUserConfig
- [ ] **4.11** 阶段 4 端到端 smoke + 收尾

## 实施日志

### 4.1 shared/defaults.ts
（待开始）

### 4.2 cli-utils
（待开始）

### 4.3 config.ts 扩展
（待开始）

### 4.4 config-routes
（待开始）

### 4.5 router 注入
（待开始）

### 4.6 cli + index 接 loadConfig
（待开始）

### 4.7 useUserConfig
（待开始）

### 4.8 SettingsModal
（待开始）

### 4.9 ShortcutSettings + CommandSettings
（待开始）

### 4.10 ConsolePage 接 SettingsModal
（待开始）

### 4.11 阶段收尾
（待开始）

## 当前阻塞

无。

## 验证结果

（阶段完成后填写）
