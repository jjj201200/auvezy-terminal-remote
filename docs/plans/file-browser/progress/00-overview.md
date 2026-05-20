# File Browser 进度总览

> 最后更新:2026-05-21(全部 8 阶段完成,可发布)

## 阶段速查

| # | 阶段 | 状态 | 关键产物 |
|---|---|---|---|
| 1 | shared 类型 + ErrorCode + FileError | ✅ 已完成 | `shared/src/files.ts`、`FileError` 子类、8 个新 ErrorCode |
| 2 | path-resolver + mime-detect + list-dir | ✅ 已完成 | `backend/src/files/*` + 23 单测 |
| 3 | /api/files/list /read /stat /raw 路由 | ✅ 已完成 | `file-routes.ts` + 9 supertest + 限流 + 审计 |
| 4 | /api/files/search SSE + search-engine | ✅ 已完成 | `search-engine.ts` + SSE + ReDoS 防护 + 8 测试 |
| 5 | 前端 FileBrowserSheet(无高亮)+ useFiles | ✅ 已完成 | `FileBrowserSheet` 组件树 + `useFiles` + i18n + presenter |
| 6 | Shiki 集成 + 主题跟随 + lang 映射 | ✅ 已完成 | `syntax-highlight.ts` lazy load + 降级 + ADR-006 锁版本 |
| 7 | 搜索 UI + 命中跳预览 + 取消 | ✅ 已完成 | `SearchBox` + `SearchResults` + streamSearch 集成 |
| 8 | smoke + 收尾 | ✅ 已完成 | curl 验证 5 端点 + CHANGELOG + ROADMAP |
| **simplify pass** | review 后 7 处清理 + 1 处合并测试 | ✅ 已完成 | `getFileKind` / `SearchMode` / `HEADER_ATR_ERROR` / 常量迁出 / readonly / 删历史注释 |

## ADR 一览

| ADR | 主题 |
|---|---|
| [001](../adrs/001-broker-not-worker.md) | 文件 API 挂 broker |
| [002](../adrs/002-readonly-only.md) | MVP 严格只读 |
| [003](../adrs/003-workdir-policy-reuse.md) | 复用 checkWorkdir |
| [004](../adrs/004-syntax-highlight-shiki.md) | 选 Shiki 做语法高亮 |
| [005](../adrs/005-search-pure-node-sse.md) | 搜索用纯 Node + SSE |
| [006](../adrs/006-shiki-version-pin.md) | shiki@4.1.0 + codeToHtml + bundle 增量验证 |

## 测试与 smoke

| 范围 | 结果 |
|---|---|
| shared vitest | 68 / 68 ✅ |
| backend vitest | 622 / 622 ✅ |
| frontend vitest | 75 / 75 ✅(含 3 个 syntax-highlight 降级测试) |
| backend typecheck | ✅ |
| frontend typecheck | ✅ |
| `pnpm build` 全链路 | ✅(bundle 311 KB,与 0.7.6 持平) |
| broker smoke(5 端点 401 拦截 + /api/health 200 + root SPA 200) | ✅ |
| 端口释放(ss -tln 确认 3737 已释) | ✅ |

## 关键约束 checklist

- [x] 所有路径输入过 `resolveSafePath(cwd, input, policy)`(resolve + realpath + checkWorkdir)
- [x] socket / fifo / device 拒读
- [x] /read 2 MiB 截断 / /raw 8 MiB 拒
- [x] 搜索单文件 100 ms / 全请求 5 s / 并发 8 / 跨行 regex 拒
- [x] /raw 错误用 X-ATR-Error header(常量从 `forwarded-headers.ts` 导出)
- [x] Shiki 200 KB 降级 + 加载失败 escapeHtml 回退
- [x] i18n zh-CN / en-US 同步
- [x] `FileError` AppError 子类 + 8 个新 ErrorCode 落 shared
- [x] 限流:per-IP /api/files/* 120/min + /api/files/search 20/min(常量在 `backend/src/constants.ts`)
- [x] checkWorkdir 命中 → 抛 `FileError(PATH_FORBIDDEN, 403)`,不复用 spawn 的 CWD_NOT_EXIST 包法
- [x] 测试用真实 tmp fixture,不 mock fs
- [x] smoke 后 kill broker + 确认端口已释放

## 后续/已知未做(MVP 范围外)

- 命中行精准跳转(需要 Shiki 输出 data-line + scrollIntoView)
- `.gitignore` 集成(目前用硬编码 IGNORE_DIRS)
- 写白名单(若未来加写能力)
- 视频/音频/zip 预览
- 真实浏览器端 UI 交互验证(用户本地手动 smoke:`pnpm build` → `node backend/dist/cli.js start` → 浏览器开 `http://localhost:3737/`(带 token) → 实例顶栏点 IconFolder)
