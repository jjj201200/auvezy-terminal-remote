# S6a · Wikilink Backend

- ✅ `WorkspaceIndex` 类:lazy build + fs.watch(recursive)+ 5min poll 兜底
- ✅ `resolve()` 算法:
  - 含 `/` → vault-root 拼 → 当前目录拼 fallback
  - 短名 → 索引(lowercased basename - ext)
  - 多匹配 → shortest-path 启发式(共同前缀目录段数最多 → 字节序最小)
  - fragment 解析:`#H2` → heading;`#^abc` → block
- ✅ symlink 跟随 + realpath 校验未跳出 cwd(隐藏目录 `.` 开头跳过)
- ✅ 单测 13 用例全过(短名 / shortest-path / 路径形态 / fragment / 并发)
- ✅ `POST /api/files/resolve-links` 端点
  - 批量(最多 200 targets);fileLimiter 限流;`from` 走 resolveSafePath 校验
  - 复用 `resolveContext` 校验 instanceId(经 query 注入)
  - 实例级 `wikilinkIndexes` Map 缓存(lazy build,broker 进程级单例)
- ✅ backend 全 664 测试通过

下一步:S6b 前端 wikilink 渲染。
