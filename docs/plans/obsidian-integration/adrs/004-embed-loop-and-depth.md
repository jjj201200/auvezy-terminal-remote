# ADR-004:embed 循环与深度限制 — 沿路径 Set 检测 + 硬上限 5

## 状态

已采纳(2026-05-22)

## 上下文

Obsidian embed `![[Foo]]` 把目标文件内联到当前文件。对 `.md` 类型,渲染时**递归**应用 MarkdownPreview(以便嵌入文件里的子 embed 也展开)。这引入两个失控风险:

1. **循环引用**:A 嵌 B,B 嵌 A → 无限递归
2. **深度爆炸**:A 嵌 B,B 嵌 C,C 嵌 D,...嵌套树过深消耗 DOM 与递归栈

实际 Obsidian vault 里这两种情况都不罕见 — 笔记互相引用是常见组织方式。我们需要既允许常见用法(嵌入引用另一份笔记的某段),又防失控。

## 决策

**双重防护**:

### 1. 路径 Set 检测(精确的循环检测)

渲染 md embed 时维持一个 `Set<resolvedAbsPath>` 沿递归路径传(React Context):

```tsx
const EmbedAncestorsContext = createContext<ReadonlySet<string>>(new Set());

function EmbedMd({ resolved, ... }: EmbedMdProps): JSX.Element {
  const ancestors = useContext(EmbedAncestorsContext);
  if (ancestors.has(resolved)) {
    return <EmbedPlaceholder kind="circular" path={resolved} />;
  }
  const next = useMemo(() => {
    const s = new Set(ancestors);
    s.add(resolved);
    return s;
  }, [ancestors, resolved]);
  return (
    <EmbedAncestorsContext.Provider value={next}>
      <MarkdownPreview path={resolved} {...} />
    </EmbedAncestorsContext.Provider>
  );
}
```

**Why Set + path**:每个 EmbedMd 只看自己**祖先链**上的路径,不影响兄弟。A 嵌 [B, B] 不算循环(两个 B 都是兄弟,各自独立渲染),A 嵌 B 嵌 A 才算。

**Why resolved 而非原始 target**:`[[Foo]]` 和 `[[notes/Foo]]` 解析到同一个文件,应识别为同一节点。统一用 resolved 后的相对路径(`resolveSafePath` 输出)。

### 2. 硬深度上限 5(防极端嵌套)

即使无循环,深度 ≥5 时停止递归,显示 `EmbedPlaceholder kind="depthLimit"`。

**Why 5**:
- 真实 Obsidian vault 数据观察:连续 embed 链长度 ≥4 极罕见
- 5 给 4 层正常用法留余地
- 上限存在的主要目的是防"配置错误造成的爆炸"(比如模板自引用),不是限制常规用法

实现:复用同一个 Context,只看 `ancestors.size`:

```tsx
if (ancestors.size >= EMBED_DEPTH_LIMIT) {
  return <EmbedPlaceholder kind="depthLimit" />;
}
```

### 3. 默认折叠(避免一次性递归拉满)

embed md 默认 collapsed,显示 `▶ Embed: notes/foo.md (12 KB)` 一行,点击展开才递归。例外:文档**只有一个** embed 节点时自动展开。

这条不是循环防护,但减轻了"一篇文档里 10 个 embed,每个又有 3 层"这种正常嵌套场景的首屏开销。

## 拒绝的替代方案

### 方案 A:不做循环检测,只设深度上限

- 深度 5 时一篇 A↔B 互嵌的笔记会渲染 5 层重复内容才停,视觉上很丑且占内存
- 实现成本与 Set 检测几乎相同(都需要传 ancestors),收益没有

### 方案 B:仅循环检测,不设深度上限

- A → B → C → D → ... → Z 这种长链合法(无环)但 26 层渲染会卡死
- 即使罕见,出现一次就是事故

### 方案 C:全局 `Map<path, depth>` 跨兄弟共享

- A 嵌 [B, B] 时,第二个 B 看到 depth 已经 +1,误判为递归
- 兄弟节点应该独立,Context 沿路径传是正确粒度

### 方案 D:深度上限 3

- 留给正常嵌套的余地太小(嵌一份"包含笔记",而那份笔记自身又嵌了一两层 — 就到 3 了)
- 5 更保守

### 方案 E:深度上限 10

- 真实用法极少超 4,设 10 等于"不设上限",防护变形式

## 后果

**正向**:
- 循环精确识别,占位提示明确
- 深度限制兜底,无论 vault 怎么写都不会卡死
- 兄弟节点独立,符合用户对"独立内容块"的直觉

**负向**:
- React Context 在每层 embed 都重新生成 Set,内存有微小开销(每 Set < 1KB,可忽略)
- 5 这个数字是经验值,未来若收到反馈"嵌 5 层不够用",调大不破坏接口

## 验证

测试用例(`embed.test.tsx`):

1. A 嵌 B 嵌 A → B 处显示 circular 占位
2. A 嵌 [B, B] → 两个 B 都正常展开(兄弟)
3. A 嵌 B 嵌 C 嵌 D 嵌 E 嵌 F → F 处显示 depthLimit 占位(嵌套 5 层后停)
4. A 嵌 B,B 不嵌 A,A 嵌另一份 X → A 中 B 和 X 都正常
5. A 嵌 B,A 又嵌 B(同一目标重复嵌入,无循环) → 两次都正常展开
6. 单 embed 文档自动展开,多 embed 默认折叠
