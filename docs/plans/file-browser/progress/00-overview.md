# File Browser 进度总览

> 最后更新:2026-05-20(设计稿落档,实施未开始)

## 阶段速查

| # | 阶段 | 状态 | 关键产物 | 阻塞 / 风险 |
|---|---|---|---|---|
| 1 | shared 类型 + ErrorCode + FileError | ⏳ 未开始 | shared/src/files.ts、FileError 子类、新 ErrorCode | 无 |
| 2 | path-resolver + mime-detect + list-dir | ⏳ 未开始 | backend/src/files/* + 单测 | 阶段 1 完成 |
| 3 | /api/files/list /read /stat /raw 路由 | ⏳ 未开始 | file-routes.ts + supertest | 阶段 2 完成 |
| 4 | /api/files/search SSE + search-engine | ⏳ 未开始 | search-engine.ts + SSE + ReDoS 防护 | 阶段 3 完成 |
| 5 | 前端 FileBrowserSheet(无高亮)+ useFiles | ⏳ 未开始 | FileBrowserSheet / useFiles / i18n | 阶段 3 可平行 |
| 6 | Shiki 集成 + 主题跟随 + lang 映射 | ⏳ 未开始 | syntax-highlight.ts + lazy load | 阶段 5 完成 |
| 7 | 搜索 UI + 命中跳预览 + 取消 | ⏳ 未开始 | SearchBox + 行跳转 | 阶段 4 + 6 完成 |
| 8 | smoke + 性能调优 + 文档 | ⏳ 未开始 | 手动 smoke + progress 更新 | 全部完成 |

## 时间线(粗估)

| 阶段 | 工作量 |
|---|---|
| 1 | 0.3d |
| 2 | 0.8d |
| 3 | 0.8d |
| 4 | 1.0d |
| 5 | 1.0d |
| 6 | 0.5d |
| 7 | 0.7d |
| 8 | 0.5d |
| **总计** | **~5.6d** |

## ADR 一览

| ADR | 主题 |
|---|---|
| [001](../adrs/001-broker-not-worker.md) | 文件 API 挂 broker |
| [002](../adrs/002-readonly-only.md) | MVP 严格只读 |
| [003](../adrs/003-workdir-policy-reuse.md) | 复用 checkWorkdir |
| [004](../adrs/004-syntax-highlight-shiki.md) | 选 Shiki 做语法高亮 |
| [005](../adrs/005-search-pure-node-sse.md) | 搜索用纯 Node + SSE |

## 关键约束 checklist

- [ ] 所有路径输入过 `resolveSafePath(cwd, input, policy)`(resolve + realpath + checkWorkdir)
- [ ] socket / fifo / device 拒读
- [ ] /read 2 MiB 截断 / /raw 8 MiB 拒
- [ ] 搜索单文件 100 ms / 全请求 5 s / 并发 8 / 跨行 regex 拒
- [ ] /raw 错误用 X-ATR-Error header,不返 JSON
- [ ] Shiki 200 KB 降级 + 加载失败 escapeHtml 回退
- [ ] i18n zh-CN / en-US 同步
- [ ] AppError 子类 `FileError` + 新 ErrorCode(`BAD_REQUEST` / `PATH_NOT_FOUND` / `PATH_FORBIDDEN` / `FILE_TOO_LARGE` / `FILE_BINARY` / `FILE_TYPE_FORBID` / `SEARCH_INVALID_Q` / `SEARCH_TIMEOUT`)落 shared
- [ ] 限流:per-IP /api/files/* 120/min + /api/files/search 20/min,用现有 RateLimiter
- [ ] checkWorkdir 命中 → 抛 `FileError(PATH_FORBIDDEN, 403)`,**不复用** spawn 的 `CWD_NOT_EXIST` 包法
- [ ] 测试用真实 tmp fixture,不 mock fs
- [ ] smoke 后 kill broker + 确认端口已释放

## 实施期"待验证"事项(design 中已用 ⚠️ 标注)

| 项 | 验证时机 | 处置 |
|---|---|---|
| shiki 当前主线版 API 形态 | 阶段 6 第一步 `pnpm add shiki@latest` 后 | 按当时 README 调,补 ADR-006 记录 |
| shiki 主 bundle 增量 ≤ 50 KB gz | 阶段 6 `vite build --report` | 超标改 Prism,触发 ADR-006 重新选型 |
| vite proxy 反代 `/api/files/search` SSE 工作 | 阶段 4 末 smoke | 已实质验证(`/api/instances/stream` 同模式工作中) |
| `realpathSync` 在 Windows 上对网络路径行为 | 阶段 2 单测覆盖 | 失败 → 抛 PATH_NOT_FOUND,与 Linux 一致 |
