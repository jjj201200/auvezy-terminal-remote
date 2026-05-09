# ADR-013: 引入 ModalStack 统一管理 modal 层级

## 状态

已接受（2026-05-09）

## 背景

0.5/0.6 阶段 modal 数量增多到 7 个（Settings / Share / CreateInstance / 主机管理 sheet / InstanceDetail / Confirm 各种形态 / 状态详情），出现以下症状：

1. **嵌套层级靠手工 hack**。`Sheet.tsx` 有 `overlayTone='strong'` + `contentBoost`
   两个手工抬升 z-index 的 prop——只支持两档（普通 / 加深），三层嵌套就坏。
2. **modal 之间的"互斥 / 替换 / 嵌套"语义靠协调**。例如 `MobileInstanceSwitcher`
   点新增的旧实现是 `setOpen(false); onCreateClick()`；我们后来加了
   `reopenManageOnCreateCloseRef` 让 create 关闭后自动 reopen sheet——双向通信
   分散在 3 个组件，每加一层就要再凑一次。
3. **每个 modal 都自己 useState 管 open**。MultiInstanceConsole 一处就有 6 个
   modal-related state（settingsOpen / shareOpen / createOpen / manageOpen /
   reopenManageOnCreateCloseRef / closeDialog）。每个 modal 调用都要写 jsx +
   open / onClose 回调对样板。
4. **关闭实例的 ConfirmModal 是个状态机**。`closeDialog` union type 4 种
   形态，4 段 jsx 组合判断。其实就是"按需弹一个 confirm"。

## 决策

引入**全局 ModalStack**：一个有序数组维护当前打开的所有 modal，最后一个 = 最上层。

```ts
const stack = useModalStack();
const id = stack.push({ kind?: string, render: (ctx) => ReactNode, ... });
stack.replace(entry);                  // 替换栈顶
stack.pop(id?);                        // 关 id（默认栈顶）；中间层 → LIFO 关掉它和之上所有
stack.popTo(id);                       // 同 pop（语义别名）
stack.dismiss();                       // 关全部
```

栈下标决定 z-index 偏移：CSS var `--modal-layer-z` 由 `ModalLayerRoot` 注入，
Sheet SCSS 用 `calc(z-base + var * 5)` 自动计算每层 backdrop / content z-index。
不再需要 `overlayTone` / `contentBoost`。

**互斥语义**：push 同 kind 自动 replace（不嵌套）；不同 kind / 无 kind → 嵌套。
这把"同一逻辑 modal 切到不同状态" 与 "嵌套子 modal" 区分清楚。

**Presenter 函数**：每个高层 modal（CreateInstanceModal 等）配一个 `useXxxPresenter()`
hook，调用方写 `present({...args})` 即可，不再 useState + jsx 对子。`useConfirm`
也接入 stack（每次 confirm 推一个嵌套 entry）。

## 理由

1. **嵌套自然支持**。N 层都行，z-index 自动递增；下层 `inert` 阻止交互，焦点自然
   归到最上层。详情 modal 再弹 confirm，再弹 confirm，一直加都不破。
2. **互斥语义清晰可测**。同 kind 互斥 + 异 kind 嵌套这条简单规则，覆盖了几乎所有
   现实需求；用 `kind` 字符串声明一次比让调用方自己 `if (open) close that one first` 简单得多。
3. **调用方代码量大幅缩短**。MultiInstanceConsole 减少 ~150 行：6 个 state + 4 个
   ConfirmModal jsx 块 → 4 个 presenter 函数 + 1 处 `await confirm()`。
4. **取消 / 返回上一步语义统一**。所有 modal 的"取消" = `ctx.close()` = `stack.pop(self)`。
   嵌套 modal 关闭后下层自然浮回 — 不需要"reopen on close" 这种 ref 跟踪。
5. **未来可扩展**。toast 共享栈、移动端 back 键关栈顶、focus-trap 集中处理 …
   都在一个地方扩展即可。

## 后果

- 正面：
  - modal 层级 / 互斥 / 嵌套全部声明式表达，调用方代码减少
  - 不再有 z-index 手工 hack
  - 嵌套 modal 焦点 / 交互正确（下层 inert）
- 负面：
  - 多了一个 Provider 必须包在 App 外层（已加到 main.tsx）
  - 调试时 React DevTools 看 stack 数组比看单个 useState 略绕一点
  - 退场动画在 stack 移除 entry 时与 Radix / vaul 自身的 unmount 同步——
    当前实现是**直接 unmount**，未走单独的"closing"中间态。视觉上有轻微
    跳变；后续可用 react-transition-group 做平滑退场

## 备选方案

- **每个 modal 自管 useState（保持现状）**：已经验证扩展不动，复杂度爆炸。
- **Radix Portal 多 instance + 手工 z-index 协调**：靠 token + 手工调度，
  与现状无本质区别，只是把 hack 集中。
- **react-modal / 现成库**：本项目不依赖第三方 modal 库（Sheet 已基于 Radix Dialog +
  vaul Drawer 自封装），引入新库会与现有 SCSS / vaul 行为冲突。

## 相关文件

- `frontend/src/components/ui/modal-stack/`
  - `types.ts` —— ModalEntry / ModalStackHandle / ModalRenderContext
  - `ModalStack.tsx` —— Provider + useModalStack hook + ModalLayerRoot（注入
    `--modal-layer-z` + `inert`）
  - `ModalShell.tsx` —— 标题 / body / footer 三段壳，封装 Sheet
  - `presenters.tsx` —— useCreateInstancePresenter / useSettingsPresenter /
    useSharePresenter / useInstanceDetailPresenter / useManageHostsPresenter
  - `ModalStack.test.tsx` —— 12 个测试覆盖 push/pop/replace/dismiss/onClosed/
    互斥/嵌套/data attrs
- `frontend/src/components/ui/Sheet.tsx` —— 删除 overlayTone/contentBoost
- `frontend/src/components/ui/Sheet.module.scss` —— 用 var(--modal-layer-z) 计算 z-index
- `frontend/src/components/ui/ConfirmProvider.tsx` —— 重写为 stack-based
- `frontend/src/main.tsx` —— ModalStackProvider 包在 ConfirmProvider 外层
- `frontend/src/pages/MultiInstanceConsole.tsx` —— 删除 6 个 modal state +
  4 段 ConfirmModal jsx，改为 presenter / useConfirm
