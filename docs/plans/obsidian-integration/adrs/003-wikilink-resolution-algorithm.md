# ADR-003:wikilink 解析算法 — 全 vault 短名 + shortest-path 启发式

## 状态

已采纳(2026-05-22)

## 上下文

Obsidian wikilink `[[target]]` 的目标解析有多种可能形态:

| target | 类型 | 解析方式 |
|---|---|---|
| `[[a/b/c]]` | 含 `/` 的路径 | vault root 相对 → 当前文件目录相对 fallback |
| `[[Foo]]` | 不含 `/` 的短名 | 全 vault 扫所有 basename = Foo 的 .md/.markdown |
| `[[Foo#H2]]` | 短名 + heading 锚点 | 解析为路径后,在目标文件里定位 heading |
| `[[Foo#^abc]]` | 短名 + block id 锚点 | 同上,定位 `^abc` 所在段落 |
| `[[Foo\|alias]]` | 任意上述 + alias | 解析路径同上,显示文本用 alias |

短名形态如果**全 vault 唯一**则直接命中。如果**多匹配**,Obsidian 使用一套**启发式**选优先目标 — 这是这条 ADR 要落地的核心。

ATR 文件浏览器以**实例工作目录**为天然 vault root(不要求 `.obsidian/` 目录存在)。这意味着我们能且应该实现完整解析。

可选实现层次:

1. **极简**:不支持短名,要求用户写完整相对路径
2. **半全**:短名形态只查同目录
3. **完整**:全 vault 扫 + 多匹配启发式(对齐 Obsidian)

## 决策

**实现完整解析(层次 3),含 shortest-path 启发式**:

### 算法步骤

```
function resolve(from: string, target: string): ResolveResult {
  // 步骤 1:切分 fragment(heading 或 block id)
  const { pathPart, fragment } = splitFragment(target);
    // 'Foo#H2'       → { pathPart: 'Foo',   fragment: { kind: 'heading', id: 'H2' } }
    // 'Foo#^abc'     → { pathPart: 'Foo',   fragment: { kind: 'block', id: 'abc' } }
    // 'a/b#H'        → { pathPart: 'a/b',   fragment: { kind: 'heading', id: 'H' } }

  // 步骤 2:判断路径形态 vs 短名形态
  if (pathPart.includes('/')) {
    // 路径形态:先按 vault root 相对解析,失败再按当前文件目录相对
    const fromVault = tryResolve(joinVault(pathPart));
    if (fromVault) return ok(fromVault, fragment);
    const fromCurrent = tryResolve(joinDir(dirname(from), pathPart));
    if (fromCurrent) return ok(fromCurrent, fragment);
    return broken();
  }

  // 步骤 3:短名形态 — 查全 vault 索引(小写、去扩展名)
  const candidates = byBasename.get(stripExt(pathPart).toLowerCase()) ?? [];
  if (candidates.length === 0) return broken();
  if (candidates.length === 1) return ok(candidates[0], fragment);

  // 步骤 4:多匹配 — shortest-path 启发式
  const best = pickShortestPath(from, candidates);
  return ok(best, fragment, { candidates });  // candidates 全量传回 UI 显示 "N 个候选"
}

function pickShortestPath(from: string, candidates: string[]): string {
  return candidates
    .map(c => ({ c, common: countCommonDirSegments(from, c) }))
    .sort((a, b) => {
      // 共同目录段数多者胜;平则用字节序 tie-break(稳定且跨平台一致)
      if (b.common !== a.common) return b.common - a.common;
      return a.c < b.c ? -1 : a.c > b.c ? 1 : 0;
    })
    [0].c;
}
```

**Why 用 `<` 字节序而非 `localeCompare`**:`localeCompare` 默认使用运行时
locale,Windows-CN 跟 Linux glibc 排中文路径行为不同 — 同一 vault 在不同
机器解析结果可能不一致。wikilink 解析必须跨平台稳定,字节序虽然对中文不
"自然",但**确定且可复现**。给个固定 locale 如 `localeCompare(b, 'en')` 也行
但更绕,直接 `<` 最简。

function countCommonDirSegments(a: string, b: string): number {
  // a = 'notes/2026/today.md', b = 'notes/2024/foo.md' → 1 ('notes/')
  // a = 'notes/today.md',      b = 'archive/foo.md'   → 0
  const da = a.split('/').slice(0, -1);
  const db = b.split('/').slice(0, -1);
  let i = 0;
  while (i < da.length && i < db.length && da[i] === db[i]) i++;
  return i;
}
```

### 索引结构

```ts
class WorkspaceIndex {
  private byBasename = new Map<string, string[]>();
  // key   = stripExt(basename).toLowerCase()       (Obsidian 大小写不敏感)
  // value = [path/相对/cwd, …]                     (基本 sorted)
}
```

**索引粒度**:
- 仅 `.md` / `.markdown` 文件参与短名索引(其它扩展名 embed 时另算)
- symlink 校验 realpath 不跳出 cwd,跳出则跳过(安全 §9)

**索引时机**:
- **lazy build**:首次 `/resolve-links` 调用时全 walk;`buildOnce` 返回 Promise,并发请求 await 同一个
- **增量维护**:`fs.watch(cwd, { recursive: true })` 监听 rename/unlink/create,失败时回退每 5 分钟全扫
- **不持久化**:重启 broker 重新 build(理由见 design.md §7.2)

## 拒绝的替代方案

### 方案 A:仅相对当前文件目录解析(不全 vault 扫)

- 优点:零索引成本
- 缺点:跟 Obsidian 原生行为差距大,Obsidian vault 里大量 `[[Foo]]` 短名形态会全部 broken。**与"最贴近 Obsidian"的目标直接冲突**

### 方案 B:混合(先同目录后全 vault)

- 优点:避免一次性扫
- 缺点:逻辑分支多,周边 case(同目录有 Foo.md 但全 vault 还有 Foo.md)行为难解释 — 跟 Obsidian 不一致
- "扫全 vault 太贵"这个前提在 lazy + 持久 watch 下被消解了:首次扫一次 ≤ 2s,之后内存查询 <10ms

### 方案 C:实现 Obsidian 的 link format 三选项(shortest/relative/absolute)

- 那是 Obsidian 的**写入**设置(决定创建 wikilink 时自动填什么路径),**不影响解析**
- ATR 只读 markdown,不需要"写入路径偏好"
- 三种 link format 写出来的链接,本 ADR 的解析算法**都能正确处理**(路径形态走步骤 2;短名走步骤 3),所以不需要实现

### 方案 D:严格大小写敏感匹配

- Linux 文件系统大小写敏感,但 Obsidian wikilink 跨平台一致地大小写不敏感
- 大小写敏感会让同一 vault 在不同 OS 行为不同,语义不稳

### 方案 E:持久化索引到磁盘

- 思路:把 `byBasename` 写到 `~/.auvezy/terminal-remote/instances/<id>/wikilink-index.json`,
  broker 重启时直接读,跳过首次 build
- 拒绝理由 1 — **stale 风险**:`fs.watch` 在 WSL / macOS 大目录环境**已知不稳**
  (design.md §12 风险表已承认)。一旦 watch 在某些环境根本不触发,持久化索引
  就**永远 stale** — 比"重启重建"更糟,因为用户感知不到何时该手动刷新
- 拒绝理由 2 — **校验也是重扫**:要避免 stale 就得启动时 stat 每个索引项校验
  mtime,这跟全 walk 重建几乎等开销,没省事
- 拒绝理由 3 — **build 不慢**:实测中等 vault(1000 md)首次 walk < 200ms,大
  vault(10000+ md)< 2s。lazy + "索引中" UI 占位足以覆盖,不值得引入 stale 风险

## 后果

**正向**:
- 对齐 Obsidian 原生行为,用户从 Obsidian 切到 ATR 预览时**无解析差异**
- 算法实现简单(总共 4 个步骤,countCommonDirSegments 不到 10 行)
- ambiguous 时把全部 candidates 传给 UI,体验上比"静默选一个"更明确

**负向**:
- WorkspaceIndex 首次 build 在超大 vault(10w+ md)可能秒级阻塞 — 用 lazy + UI "索引中" 占位缓解(design.md §12)
- 同名文件多于一个时,启发式可能跟用户期望不符(罕见);UI 显示 "{n} 候选" 帮用户察觉
- 对 case-sensitive 文件系统上意图保留大小写区分的用户,这里 lowercase 统一可能"过宽" — 暂不支持

## 验证

测试用例(`wikilink-resolver.test.ts`):

1. 短名唯一 → 命中
2. 短名 0 命中 → broken
3. 短名多命中 + 共同前缀目录差异 → shortest-path 胜
4. 短名多命中 + 共同前缀目录相同 → 字典序胜
5. 路径形态 vault root 命中
6. 路径形态 vault root 不在 + 当前目录相对命中(fallback)
7. 路径形态都不命中 → broken
8. heading fragment 切分 + 路径仍正确解析
9. block id fragment 切分
10. alias `|` 不影响解析
11. 大小写不敏感:`[[FOO]]` 命中 `foo.md`
12. `.markdown` 与 `.md` 等价:`[[Foo]]` 命中 `Foo.markdown`
13. symlink 跳出 cwd 不被索引
