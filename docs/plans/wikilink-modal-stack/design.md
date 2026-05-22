# Wikilink 跨文件预览 — Modal Stack 叠加

## §1 问题

Obsidian wikilink 当前调 `useFilePreviewPresenter`,而 presenter 用
`kind: 'file-preview'`(`presenters.tsx:175`)。ModalStack 同 kind 互斥规则
(`ModalStack.tsx:128-135`)使新预览**替换**当前预览,造成:

- 用户失去原文件阅读位置(Sheet 卸载,scrollTop 丢)
- 没有"返回上一层"语义 — 只能从新文件 esc 退回 FileBrowser 列表,无法回到引用源
- 链式跳转(A → B → C → D)无栈,esc 一次性回到根

## §2 目标

1. Wikilink 跳转 push 新 modal,esc 关栈顶 = 返回上一层文件,原阅读位置自然保留
2. **环检测**:同一 `(instanceId, path)` 已在栈中 → 不再新 push,而是把已有那层
   "提到栈顶";中间层全部保留挂载状态、滚动位置、所有 React state
3. 深栈提供"全部关闭"出口 — 把所有 file-preview 一次清掉,但保留 FileBrowser 等
   其它 modal
4. **FileBrowser 入口语义不变** — 从文件列表点新文件仍 replace(单例),不堆栈

## §3 关键设计抉择

### 3.1 "提到栈顶"不动 DOM

物理上**不**移动栈数组里的 entry,只更新它的 `topRank`(单调递增)。
React 渲染顺序保持数组顺序,portal container 引用稳定 → DOM 节点不动 → scrollTop
零副作用。

视觉层"谁在上"由 `z-index = BASE + topRank` 决定;`isTop = topRank === max(topRank)`;
`inert = !isTop`。

这点是**关键创新**:原方案"DOM 顺序天然叠加,不依赖 z-index"被打破,但换来
bringToTop 0 副作用。modal-stack 原本就有 z-index token,只是被 DOM 顺序 enforce,
现在改成显式控制。

### 3.2 `kind` vs `group` 语义分离

- `kind`:单例语义 — 同 kind push 自动 replace(现状,如 settings, instance-detail)
- `group`:批量语义 — 允许叠加多个同 group entry,提供 `popGroup` 操作

wikilink push 的 entry **不带 kind**(允许叠加)、**带 `group: 'file-preview'`**
(供"全部关闭"使用)。

FileBrowser 入口用的 `useFilePreviewPresenter`(已存在)**保留 `kind: 'file-preview'`**
不变 — 它是文件列表的单例预览,语义是替换。

两条路径产生的 Sheet 是同一个 `FilePreviewSheet` 组件,但 entry 元数据不同,
互不影响。

### 3.3 环检测与 anchor 重激活

bringToTop 不重 mount MarkdownPreview → useEffect 不会自动重跑 → `consumePendingAnchor`
不会被触发。所以需要把 `topRank` 通过 `ModalRenderContext.activatedSeq` 透出,
MarkdownPreview 把它加入 anchor effect 的 deps,bringToTop 时强制重跑。

`setPendingAnchor` 模块级单槽够用 — wikilink onClick 是同步行为,
push/bringToTop 紧跟 setPendingAnchor 之后,中间不会插队。

### 3.4 不设栈深上限

环检测已防止 A→B→A 无限增长。即使全 vault 不同文件链式跳,也就栈深 = 文件数,
内存可控(每层都是已挂载 MarkdownPreview,但 React tree 共享 ctx,实际开销可接受)。

## §4 接口变更

### 4.1 `types.ts`

```ts
export interface ModalEntryInput {
  kind?: string;            // 不变
  group?: string;           // 新增:批量操作分组
  meta?: Readonly<Record<string, unknown>>;  // 新增:供 find / 调用方查询
  render: (ctx: ModalRenderContext) => ReactNode;
  dismissible?: boolean;
  onClosed?: () => void;
  debugLabel?: string;
}

export interface ModalEntry extends Required<Pick<ModalEntryInput, 'render'>> {
  id: string;
  kind: string | undefined;
  group: string | undefined;          // 新增
  meta: Readonly<Record<string, unknown>> | undefined;  // 新增
  dismissible: boolean;
  onClosed: (() => void) | undefined;
  debugLabel: string | undefined;
  closing: boolean;
  topRank: number;                    // 新增:决定 z-index / isTop
}

export interface ModalStackHandle {
  push: (entry: ModalEntryInput) => string;
  replace: (entry: ModalEntryInput) => string;
  pop: (id?: string) => void;
  popTo: (id: string) => void;
  dismiss: () => void;
  depth: () => number;
  // 新增:
  bringToTop: (id: string) => void;
  find: (predicate: (meta: Readonly<Record<string, unknown>> | undefined) => boolean) => string | undefined;
  popGroup: (group: string) => void;
}

export interface ModalRenderContext {
  // ...原字段不变
  activatedSeq: number;  // 新增 = entry.topRank,bringToTop 时变化
}
```

### 4.2 `ModalStack.tsx`

- `topRankSeq` 模块级单调递增计数器,每次 push / bringToTop 取下一个
- `push`:entry.topRank = ++topRankSeq
- `bringToTop(id)`:setState 更新对应 entry 的 topRank,**不移动数组位置**
- `ModalStackPortal` 内 `maxTopRank = max(stack.topRank)`,`isTop = entry.topRank === maxTopRank`
- `ModalLayerRoot` 用 `style={{ zIndex: BASE_Z + entry.topRank }}`,移除"靠 DOM 顺序"的依赖
- `find`:`stack.find(e => predicate(e.meta))?.id`
- `popGroup(group)`:同 `pop`,但作用于 `entry.group === group` 的所有 entry
  (与 `pop` 行为一致 — closing 标记 + 退场动画 + onClosed)

### 4.3 `presenters.tsx` 新增 `useFilePreviewPusher`

```ts
export function useFilePreviewPusher() {
  const stack = useModalStack();
  return useCallback((args: PresenterArgs<WithoutOpen<FilePreviewSheetProps>>) => {
    const { onClosed, instanceId, target } = args;
    const existingId = stack.find(m =>
      m?.['instanceId'] === instanceId && m?.['path'] === target.path
    );
    if (existingId) {
      stack.bringToTop(existingId);
      return existingId;
    }
    return stack.push({
      group: 'file-preview',
      meta: { instanceId, path: target.path },
      debugLabel: `file-preview:${target.path}`,
      onClosed,
      render: (ctx) => (
        <FilePreviewSheet
          instanceId={instanceId}
          target={target}
          open={ctx.isOpen}
          onOpenChange={(next) => { if (!next) ctx.close(); }}
        />
      ),
    });
  }, [stack]);
}
```

注意:`FilePreviewSheet` 需要新接受 `activatedSeq` prop 透传给 MarkdownPreview。
但 `FilePreviewSheetProps` 上不暴露这个字段 — render 函数内部从 `ctx` 取并通过
新增的 `activationSeq` prop 传入。

### 4.4 `FilePreviewSheet.tsx`

- 新 prop `activationSeq?: number`(可选,FileBrowser 入口不传)
- 透传给 `PreviewPane`,PreviewPane 再传给 `MarkdownPreview`
- headerExtra 增加"全部关闭"按钮:`stack.depth() >= 2 && entry.group === 'file-preview'`
  时显示,点击 = `stack.popGroup('file-preview')`

"depth ≥ 2 且 当前是 file-preview"判断的简化:用 `stack.depth() >= 2` 加
"是否存在其它 file-preview"。最简单实现:`FilePreviewSheet` 通过 `useModalStack`
读取栈状态。但 `useModalStack` 现在返回的是 handle,不是 state。

→ 新增 `useModalStackState()` 或让 `FilePreviewSheet` 直接接 prop `showCloseAll: boolean`,
由 pusher 在 render 内根据 `ctx.index` 计算后传入。倾向后者(不扩 ctx API):
- ctx.index 是 entry 在数组里的位置(不是 topRank)
- 但"是否有其它 file-preview"需要看全栈 — 比较麻烦
- 最干净:`ctx` 加 `groupSize: number`(同 group 的 entry 总数),pusher 算好传 prop

最终方案:`ModalRenderContext` 加 `groupSize: number` 字段,FilePreviewSheet
传 `showCloseAll={groupSize >= 2}` 给自己,按钮 onClick = `stack.popGroup('file-preview')`。

### 4.5 `MarkdownPreview.tsx`

- 新 prop `activationSeq?: number`
- anchor 触发的 useEffect deps 增加 `activationSeq`
- 其它逻辑不动

### 4.6 `wikilink.tsx`

```ts
- import { useFilePreviewPresenter } from '../../../ui/modal-stack/presenters.js';
+ import { useFilePreviewPusher } from '../../../ui/modal-stack/presenters.js';
...
- const presentPreview = useFilePreviewPresenter();
+ const presentPreview = useFilePreviewPusher();
```

仅函数名替换,签名一致。

## §5 不改动的部分

- `Sheet.tsx`:headerExtra 槽已存在,无需扩 API
- `useFilePreviewPresenter`:保留,FileBrowser 入口继续用,语义不变
- `EmbedAncestorsProvider`:仍只防单文档内 `![[self]]` embed 自指。跨 modal 引用
  的"环"由 bringToTop 化解,不需 ancestors 传递
- `anchor-bus`:模块级单槽,无并发风险

## §6 测试要点

### 单元(ModalStack.test.tsx)

1. `push` 两个不同 entry → 数组长度 2,topRank 单调
2. `bringToTop(底层 id)` → 数组位置不变,topRank 变最大,isTop 切换
3. `find(predicate)` 命中/不命中
4. `popGroup('x')` 关掉所有 group=x 的,其它保留
5. `kind` 互斥规则不受影响(回归)

### 集成(手动 smoke)

1. vault 里建 A.md / B.md / C.md,A 里 [[B]],B 里 [[C]],C 里 [[A]]
2. 从 FileBrowser 打开 A → 栈 = [A]
3. 在 A 点 [[B]] → 栈 = [A,B],A scrollTop 保留
4. 在 B 点 [[C]] → 栈 = [A,B,C]
5. 在 C 点 [[A]] → A 已存在 → bringToTop,栈数组仍是 [A,B,C] 但 A 在顶,
   B/C 滚动位置保留
6. esc → A 关 → B 在顶 + 原滚动位置
7. 在某 file-preview 内点"全部关闭" → 关到只剩 FileBrowser 那层
8. wikilink 带 anchor `[[B#H2]]`,跨 bringToTop 后能滚到 #H2

## §7 风险与回退

- **z-index 显式化**:破坏了"DOM 顺序天然分层"原则。若其它 modal 实现依赖
  DOM 顺序(比如手动套了 portal),会出问题。审视现有 modal — 全部走 ModalShell
  / Sheet → 都通过 useModalLayer().container 决定 portal target → 全部统一,
  改 z-index 是安全的
- **`ctx.activatedSeq` 重触发 effect 的成本**:首次 mount 已经触发一次
  consumePendingAnchor,bringToTop 再次触发会调 `consumePendingAnchor` — 但
  pending 已被消费清空,不会有副作用。需要在 wikilink onClick **先**
  setPendingAnchor 再 bringToTop,保证 pending 有值
- 回退:revert PR 即可。useFilePreviewPresenter 始终保留,wikilink import 路径回滚
