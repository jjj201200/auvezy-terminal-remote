# ADR-003: 复用 checkWorkdir 而非新增独立白名单

## 状态

已采纳(2026-05-20)

## 上下文

文件浏览需要"哪些路径用户可读"的策略。项目已有 `backend/src/utils/workdir-policy.ts:checkWorkdir(cwd, allow, deny)`,语义是"哪些路径可作为实例的 spawn cwd",默认 deny 含 `/etc /root /sys /proc`。

有两个选择:
1. 复用 `workdirAllow / workdirDeny`(spawn 时也用);
2. 新增 `fileReadAllow / fileReadDeny` 专属于文件浏览。

## 决策

**复用 `workdirAllow / workdirDeny`**(同一对 picomatch glob 列表)。`/api/files/*` 每个请求都过 `checkWorkdir(resolved, allow, deny)` 同款判定。

## 拒绝的替代方案

### 方案 A:独立 `fileReadAllow / fileReadDeny`

- 用户要再学一组配置;
- 实际语义高度重叠("能 spawn 的目录基本就是能读的目录");
- 配置项膨胀,易出错(用户配了 `workdirAllow` 但忘配 `fileReadAllow`,新功能直接不可用)。

### 方案 B:不做策略,任意路径都读

- 即使有鉴权,token 一旦泄露,等于把整机 FS 暴露给攻击者;
- 与项目"安全红线"(CLAUDE.md)直接冲突。

## 理由

1. **语义一致**:"用户授信的工作目录"本来就该既能 spawn 也能浏览;
2. **零配置成本**:用户已配的 workdir 策略立即对新功能生效;
3. **默认安全**:默认 deny 已含 `/etc/** /root/** /sys/** /proc/**`,新功能继承零成本;
4. **未来需要差异化**(例如允许浏览但禁止 spawn 的目录)再加新字段不迟,YAGNI。

## 后果

- ✅ 用户无新增配置负担;
- ✅ `/api/workdir-policy` 端点的 allow 列表可直接复用于前端"快速跳转"按钮(显示用户授信目录);
- ⚠️ 默认 allow 为空(用户没配)时,文件浏览也"全机可读"——与 spawn 一致,文档需讲清楚;
- ⚠️ deny 列表新增 pattern 时,会同时影响 spawn 与浏览——这是好事(统一信任边界),但 CHANGELOG 需要说明。
