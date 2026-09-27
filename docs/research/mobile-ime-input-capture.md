# 移动端 IME 输入捕获：现成方案调研

> 调研日期：2026-09-27
> 背景：0.18.0 刚以三连手写 hack 修复无输入框模式移动端输入（退格失效 / 长按延迟 /
> 双发）。调研业界是否有现成、成熟的输入捕获方案可借鉴或复用，避免继续逐坑手写。

## 我们的场景约束（评估一切方案的对照基准）

| 约束 | 内容 |
| --- | --- |
| 交互形态 | 无输入框模式：全屏终端画面，**无可见输入框**，仅一个不可见隐藏 textarea 承接 IME 输入 |
| 回显模型 | **远端回显**：输入经 WS 转字节流发远端 PTY（insert→text、delete→`\x7f`×N、控制键→转义序列），PTY 输出回传后才渲染。**本地 textarea 不回显、恒为空**（stream 模式） |
| 代码位置 | `frontend/src/components/input/DirectInputCapture.tsx`、`frontend/src/hooks/useTextareaInputGuard.ts` |
| 目标平台 | iOS Safari/WebKit（含搜狗等第三方 IME）、Android Chrome（Gboard 及第三方） |

### 已手写的 hack（0.18.0 三连修）

1. **ZWSP 零宽哨兵常驻**：空 textarea 上 iOS WebKit / 第三方输入法的退格**不派发**
   `beforeinput(deleteContentBackward)`（无可删内容）。恒放 1 个哨兵字符让每次退格
   "有内容可删"；commit 后微任务写回哨兵（必然先于下一次键盘事件）。
2. **`beforeinput(insertText)` 同步 commit + 60ms 限速合并**：键盘 repeat（20-30 次/秒）
   压到 ~16 次/秒，窗口内合并、首键零延迟、数量守恒。
3. **回声队列去重**：第三方 IME 的终态异步写入发生在哨兵写回微任务之后，同一字符被
   防抖 diff 再 commit 一次（双发）。即时通道 commit 过的序列进回声队列，flushDiff
   发现在途回声即整批丢弃。
4. **CodeMirror domchange 风格防御**：80ms 防抖 diff + iOS smart-punct 模式矫正
   （`prev='X '` `actual='X.'` → commit 标点、撤销空格删除）。
5. **IME composition 冻结**：composition 期间不处理 diff，compositionend 整段 send。

### 架构定位（调研后修正）

预调研时的假设"xterm.js 是本地回显、我们是远端回显"**不准确**：xterm.js 的输入
路径同样是"发给宿主、等回显"——`CoreService.triggerDataEvent`（5.5.0
`src/common/services/CoreService.ts:58-78`）只做 disableStdin 检查 +
`_onData.fire(data)`，无任何本地写 buffer 动作，渲染完全来自 PTY 回显字节流经
本地 VT 解析器 `write()` 回来。**真正的差异在渲染侧**：xterm.js 本地持有终端
状态机（可查光标坐标，IME 组合预览可定位），我们无状态。因此 xterm.js 输入层
机制大部分可直接对照，无需"从本地回显改造"。

## 调研发现

### A. 标准与编辑器（EditContext / CodeMirror / Monaco / xterm.js）

#### EditContext API：唯一对症的平台级方案，但 iOS 上不存在

**设计目标与我们同构**：W3C Edit Context spec（微软提案）开宗明义是为"作者自绘
文本"（canvas/WebGL 渲染、无 contenteditable/textarea）设计——作者自己持有文本
状态（`ctx.text` + selection），平台输入服务（软键盘 / IME / 听写）直接对着这份
状态工作。"无输入框终端 + 本地恒空 + 输入只是字节流意图"正属此类。
（来源：[W3C spec](https://w3c.github.io/edit-context/)、
[WebKit/standards-positions #243](https://github.com/WebKit/standards-positions/issues/243)）

关键 spec 语义：

- EditContext 激活期间 UA **不得改 DOM、不得派发 input 事件**，composition 事件
  改派发到 EditContext 上——**"IME 异步写回与哨兵写回的竞态"这一 bug 类别在
  结构上不存在**（没有 textarea 可写）。
- 删除是 API 一等公民：`deleteContentBackward/Forward` 等以 `textupdate`
  （range + text）送达，不依赖 DOM 变化——"空编辑区退格无事件"的问题类别在
  支持的浏览器里消失（基于 spec 的机制性推断，非实测）。
- `characterboundsupdate` 必须同步回 `updateCharacterBounds()`，否则 IME 候选窗
  位置抖动——反过来说，**IME 候选窗可精确贴终端光标，是 textarea 模型做不到
  的白送体验提升**。
- 无障碍是作者责任：EditContext 的 text 不暴露给 AT，需自行做 DOM 镜像 +
  `role="textbox"`。

**浏览器支持矩阵（2026-09，caniuse）**：

| 浏览器 | EditContext | VirtualKeyboard API |
|---|---|---|
| Chrome / Edge | ✅ 121+ | ✅ 94+ |
| Chrome Android / Samsung Internet 25+ / Opera 107+ | ✅ | ✅ |
| **Safari（含 iOS，至 27.2）** | ❌ | ❌ |
| **Firefox（至 159）** | ❌ | ❌ |

（来源：[caniuse editcontext](https://caniuse.com/mdn-api_editcontext)、
[caniuse virtualkeyboard](https://caniuse.com/mdn-api_virtualkeyboard)）

**Safari 前景（决定性）**：WebKit 跟踪 bug
[#269922](https://bugs.webkit.org/show_bug.cgi?id=269922) 被问及是否开发时官方
答复 **"There is no active plan as far as I know"**；
[standards-positions #243](https://github.com/WebKit/standards-positions/issues/243)
至今 open、无立场标注。Mozilla 同样无 position。**中短期（≥2027）iOS 上不可能有
EditContext。**

**对我们四个手写 hack 的逐一对答**：

| 手写 hack | EditContext 能否替代 | 说明 |
| --- | --- | --- |
| ZWSP 哨兵 | ✅ 支持浏览器可删 / ❌ iOS 无从谈起 | 删除走 textupdate，无 DOM 依赖 |
| 回声队列去重 | ✅ 结构性消除 | UA 不写 DOM、单一真相源 |
| smart-punct 矫正 | ❌ 不免费 | 平台修正以 `beforeinput(insertReplacementText)` 到达仍需自己处理（CM 6.30.0 专门修过） |
| 80ms 防抖 diff | ✅ 不再需要 | textupdate 自带精确 range+text |

**大项目迁移实录**（判断迁移风险的依据）：

- **VS Code（最成功）**：[issue #207700](https://github.com/microsoft/vscode/issues/207700)
  动机原文 "Very likely fixes many IME bugs"；1.94（2024-09）实验开关 →
  [1.101（2025-06）默认启用](https://code.visualstudio.com/updates/v1_101)：
  "This fixes numerous bugs, especially in relation to the IME experience."
  非 Chromium 回退旧 hidden textarea 路径（**双路径并存**）。
- **CodeMirror（坎坷后收敛）**：6.28.0（2024-06）主线启用 → 一个 bug 报告后立即
  回滚 → 6.28.2 起**仅 Chrome 126+ 默认启用** + 全局逃生门 `EditorView.EDIT_CONTEXT
  = false` → 至 6.36.3 持续修 Chromium 实现 bug（倒置选区、IME 定位错、内存泄漏、
  三星键盘、Android 漏发 compositionend）。教训：**必须按引擎版本 gate + kill
  switch**。
- Monaco 官方 README：移动端浏览器 **"No."**（微软直接宣布不支持）。

**判断：不值得现在迁移。** 用户大头在 iOS/WebKit（EditContext 永远缺席，双路径
100% 要维护）；现有 textarea hack 已覆盖主战场；Chromium 实现的坑史意味着
"迁移 = 把一组已知 bug 换成一组未知 bug"。**条件启动**：若未来 Android Chromium
第三方键盘问题成为主要反馈，按 CM 的 gate 条件（Chrome ≥126）+ kill switch 双
路径接入，白送收益是 IME 候选窗贴终端光标。

#### 可直接借鉴的防御机制（CM input.ts / xterm.js 源码）

**架构澄清**：CM6 输入面是 contenteditable（可见编辑区），与"本地恒空、远端
回显"冲突——**只能借鉴其事件防御层，不能借鉴其输入面**。xterm.js 与我们最
同构（隐藏 textarea + 本地终端状态机）。

CodeMirror `input.ts` 中我们**尚未借鉴**的防御（来源：
[codemirror/view/src/input.ts](https://github.com/codemirror/view/blob/main/src/input.ts)）：

1. **Android GBoard Enter 前的假退格串**：按 Enter 会先发一串 spurious
   `deleteContentBackward`——可在"insertParagraph 邻近窗口内丢弃
   deleteContentBackward"（我们退格限速器的自然延伸）。
2. **iOS Enter 不 preventDefault**：preventDefault 会让虚拟键盘"卡在小写
   状态"——存 `pendingIOSKey` 放行默认行为，250ms 后重派发。**这是无输入框
   模式 iOS 上最容易踩的下一个坑。**
3. **Safari 死键组合忘发 compositionend**：安排 20ms 延迟补偿。
4. **beforeinput 时记录 insertText 的 data+时间戳**，DOM 读值时对账——比纯
   diff 多一层确定性。
5. Android 退格命中不可编辑节点时键盘自动收起（视口变大）→ 主动 refocus。
6. keyCode 229 特判（IME 在途标记，xterm.js / CM 均特判；`isComposing` 2026-09
   达 Baseline）。

xterm.js `CompositionHelper.ts` 的同类经验（来源：
[xterm.js 源码](https://github.com/xtermjs/xterm.js/blob/master/src/browser/input/CompositionHelper.ts)）：

1. **不信任 compositionend 的 data**："unreliable, at least on Chromium"——
   终态一律从 textarea 实际 value 切片（与我们 flushDiff 同哲学）。
2. **双发防护与我们 0.18.0 同源**：注释直言 "input characters can be
   duplicated (Issue #3191)"——keydown 已发送的字符在终态切片时扣掉。
3. **textarea 至少 1×1 且随组合视图移动**："otherwise certain IMEs may
   break"——候选窗锚定需要真实几何。
4. 隐藏 textarea 设 `autocorrect='off'`、`autocapitalize='off'`——**我们需核对
   哨兵 textarea 是否已设全 `autocapitalize=off autocorrect=off
   autocomplete=off spellcheck=false`**（autocapitalize 在 Safari/Chrome 默认
   `sentences`，不关会引入一类大小写干扰）。

#### 标准行为速查（2026-09 核验）

| 行为 | Chromium | iOS WebKit | Firefox |
|---|---|---|---|
| EditContext | ✅ 121+ | ❌（无开发计划） | ❌（无 position） |
| 虚拟键盘 keydown | `key` 多为 `Unidentified` | 同左，偶发真 key 被组合事件包围 | 报 `Process` |
| keydown during IME | keyCode 229 | 同 | 同 |
| beforeinput 移动端语义 | GBoard Enter 前假退格串；preventDefault 常无效 | 组合中 deleteContentBackward+insertText 连发、组合中不可取消 | — |

### B. 终端类项目（xterm.js / noVNC / Guacamole / wterm / ttyd 系）

#### xterm.js 输入层：无哨兵、无 beforeinput，移动端 = 社区自助

（源码行号为 5.5.0 / 6.0.0-master 实测）

- **隐藏 textarea**：`xterm-helper-textarea`，属性
  `autocorrect=off / autocapitalize=off / spellcheck=false`（6.0 加
  `autocomplete=off`）+ `tabIndex=0`；CSS 三重隐藏（透明 + 移屏外 -9999em +
  零尺寸）。`_syncTextArea` 在每次光标移动时把 textarea 回移到光标 cell 的像素
  位置——IME 候选框贴光标。
- **没有哨兵机制**：全仓库 grep `sentinel|zwsp|u200b` 与输入无关。桌面退格靠
  `keydown(8)` 发 `\x7f`；IME 激活期（keyCode=229）退格走 value-diff 兜底，但其
  前提是 value 里有组合文本——**上游没有解决"空 textarea 上 IME 退格不派发
  事件"**。我们的 ZWSP 哨兵属自创，直接对应物只在 noVNC / Guacamole / wterm。
- **composition 处理**（`src/browser/input/CompositionHelper.ts`）：不信
  `compositionend.data`（Chromium 上不可靠），`setTimeout(0)` 后从 textarea 实际
  value 切终态；**三重防重**——`_dataAlreadySent`（keydown 已发字符在终态切片
  时扣掉，issue #3191）、`_isSendingComposition` 标志、位置快照深拷贝。组合预览
  是自绘 div（textarea 不可见），同时保证 textarea ≥1×1（"otherwise certain
  IMEs may break"，PR #3251 修 QQ 拼音/Rime 罢工）。
- **keyCode 229 非组合态兜底**：`_handleAnyTextAreaChanges` 纯 value diff——
  变长发新增、变短发一个 `\x7f`、等长不同值整串重发。**已知缺陷**：变短只发一个
  DEL 不管删几个；整串重发分支被 issue #6078 认定有 bug（textarea 累积 +
  `String.replace` 匹配失败）。我们的"恒空+哨兵+位置化 diff"天然免疫这两类。
- **input 事件只认 `insertText`**（为 emoji IME），`deleteContentBackward` 等
  一概不处理——**全仓库不用 beforeinput**；防双发靠
  `_keyDownHandled/_keyDownSeen/_keyPressHandled` 三标志，而**不清空 value**
  （screen reader 依赖累积值朗读——"每次输入后清空"的修复方案曾因伤 a11y 被否，
  PR #4265）。
- **官方态度**：移动端伞形 issue #1101 2021 关闭（"should work on mobile, if
  there are any other specific problems…"）；Tyriar 2022 对 #3600："very low
  on my priority list"；jerch 2024 对 #5108："none brought up any good solution
  yet"；2026 对 iOS PR #5614："I don't have an iOS device"。**移动端 issue 大量
  open 无人收**（#3600 Android 整串重写、#4447 Gboard 下 `5` 双发竞态实锤、
  #5835 iOS 中文标点、#5887/#6045 全键 229 输入法 input 先于 keydown 到达、
  #6078 diff 整串重发——全部 open）。

#### 同模型项目：业界至少 5 处独立实现的收敛模式

**noVNC**（`app/ui.js:1657-1731`）：移动端用隐藏 textarea（1px×1px、
`left:-40px`，**非 display:none 以保焦点**），**哨兵 = 99 个 `_`**；input 值
diff：变长→退格数、autocorrect 改写→"先退格再重放"；**空值防御**：`newLen<1`
时重置哨兵 + blur + `setTimeout(focus)`，注释原话 "There always have to be
some text … with which backspace can interact"。桌面路径纯 keydown→keysym，无
composition——桌面中文基本不可打，靠剪贴板。

**Apache Guacamole**（最完整公开实现）：1.0.0 起引入 `InputSink`（常驻隐藏
textarea，类注释明说 composition/input 事件"may require a focused input field
to be dispatched at all"）。移动/IME 官方主路径是 **text input 模式**——**可见**
单行 textarea，**ZWSP 双侧各 ×4 padding**（注释："so there is something to
delete with backspace or del"，双向 padding 换退格/Delete 语义区分）；
composition 期间丢弃 input；diff 变短→`0xFF08`×n / `0xFFFF`×n；三个我们没有的
机制：
- **`ALLOWED_KEYS` 白名单**：输入框聚焦时只放行方向键等物理 keydown，屏蔽其余
  防双发（`guacTextInput.js:57-89`）；
- **`sentText` 一秒本地回显补偿**：远端回显延迟期间显示已发送文本 1 秒后移除
  ——**对远端回显场景低成本高体验的直接可借鉴件**；
- 官方文档定调：移动软键盘 "are not true keyboards per se and do not produce
  key presses… text input mode is required"；IME 同理。**官方承认纯 keydown
  模型在移动端是死路。**
- 长龄未修 bug 警示：GUACAMOLE-1423（哨兵 diff 计数未复位→退格越删越多）、
  GUACAMOLE-1927（Firefox 中文双发——仅事件标志挡不住异步双发，**我们的回声
  去重层比它走得远**）。

**vercel-labs/wterm**（与我们同构度 100%，npm `@wterm/dom`，2026 活跃）：
Zig→WASM VT 解析 + 自研 DOM 渲染，输入=隐藏 textarea + **ZWSP 哨兵逐字与我们
相同**（`TOUCH_INPUT_PLACEHOLDER`，注释："iOS needs a deletable value to keep
emitting input events for held Backspace"）；`suppressNextTouchDeleteInput`
（keydown 发过 Backspace 后抑制首个原生删除 input，与我们防双发同构）；
**composition commit 250ms 去重窗口**（与我们回声队列同构）；**touch 设备上
textarea opacity=1、一格尺寸、pointerEvents=auto**（issue #32 教训："A fully
transparent element is ignored by iOS keyboard and paste UI"）。它比我们少的：
无限速、无 smart-punct 矫正（靠属性关闭）。

**流行 web 终端几乎全部纯靠 xterm.js**：ttyd 无任何移动处理（虚拟按键社区 PR
#1493 open 无人收）；wetty 是唯一做全套的（`.xterm-screen` 设
`contenteditable=true` 触发软键盘 + Esc/Tab/Ctrl 虚拟按键，Ctrl 的字母先上屏再
`setTimeout(100ms)` 补 `\x7f` 删掉）；sshx / GoTTY 零处理；VS Code 的 IME 修复
方式 = bump xterm 版本。

**可复用库结论：品类不存在**。npm registry 逐关键词验证——不存在"输入意图捕获
层"独立库；成熟实现全部内嵌且不拆包（xterm.js core、`@codemirror/view`、
VSCode/Monaco、`@wterm/dom` 内部）。`simple-keyboard` 只是自绘 on-screen
keyboard（可作 extra-keys 工具条，不解决核心捕获）。

#### spec 佐证

`beforeinput` 的 inputType 枚举在 Input Events Level 2 §6.1.2（不在 UI Events）；
composition 事件顺序保证在 UI Events §3.6.2；keyCode 229 = legacy 层 IME 标记
（UI Events §3.5.1.2 不定义其值）。**"空 textarea 上 iOS 不派发
deleteContentBackward" 无公开 WebKit bug 票**（社区共识，以 Slate #1177 /
ProseMirror #11211 / wterm #32 等形式广泛记录）。

## 结论与建议

### 1. 总答案：没有 npm 现成方案，但我们的路线踩在业界收敛点上

业界不存在可安装的"成熟方案"——所有远端回显项目各自手写同构 hack。但存在
**至少 5 次独立实现收敛出的共同模式**：

> 移动端放弃 keydown 语义 → 隐藏/可见 textarea 承接系统 IME → **哨兵字符常驻
> 保证退格可删**（noVNC 99×`_`、Guacamole 8×ZWSP、wterm 1×ZWSP、我们 ZWSP）→
> input 值 diff 推导意图 → 每次处理后重置哨兵 → composition 冻结、end 后发
> 终态 → **显式去重层防双发**（xterm `_dataAlreadySent`、VS Code 100ms 忽略窗、
> wterm 250ms 窗口、Guacamole 教训反证、我们回声队列）。

0.18.0 的三连修不是孤例 hack，是这条收敛路线上的又一次独立实现。**我们独有的
部分**：`beforeinput(insertText)` 同步 commit（xterm.js/wterm 都只听 input）、
60ms 限速、smart-punct 模式矫正——这三样业界无直接对应（CM 有 double-space
句号矫正近亲）。

### 2. 低成本增强候选（按性价比排序）

| # | 增强 | 来源 | 说明 |
| --- | --- | --- | --- |
| 1 | `sentText` 一秒本地回显补偿 | Guacamole `guacTextInput.js:238-247` | 远端回显延迟期间显示已发送文本，1 秒后移除——对高延迟链路体验提升明显，成本极低 |
| 2 | `ALLOWED_KEYS` 白名单 | Guacamole `:57-89` | 聚焦时只放行方向键等物理 keydown，系统性防 keydown 兜底与 input 双发（我们现在逐键判断） |
| 3 | iOS Enter 的 pending 重派发 | CM `input.ts` | preventDefault Enter 会让 iOS 虚拟键盘"卡小写"；存 pending 250ms 后重派发。**下一个最可能踩的坑** |
| 4 | Android GBoard Enter 前假退格串丢弃 | CM changelog | insertParagraph 邻近窗口内丢弃 deleteContentBackward——退格限速器的自然延伸 |
| 5 | Safari 死键忘发 compositionend 的 20ms 补偿 | CM `input.ts` | 死键组合（alt 组合重音）场景 |
| 6 | IME 候选窗贴终端光标 | xterm.js `_syncTextArea` | 我们有 TerminalState grid 可查光标像素位置，能把 textarea（随候选窗）移过去；wterm/xterm 都验证了候选窗锚定价值 |

已核对**已达标**项（无需行动）：textarea 属性全关（含 `writingsuggestions` /
`translate` / `inputMode=url`）、textarea 贴可视区底部 1px（非 -9999em 移屏，
符合 wterm #32 教训）。

**可自查隐患**：我们 textarea 设了 `pointer-events: none`（为不挡 xterm 手势），
wterm #32 记录该属性会杀死 iOS 原生长按粘贴菜单——若移动端长按粘贴走系统菜单
路径则受影响，需真机验证（若只走工具条/菜单按钮粘贴则无碍）。

### 3. EditContext：条件启动项，不迁移

唯一对症的平台级标准，但 Safari（无开发计划）与 Firefox（无 position）都不支持
——iOS 是我们主战场，双路径 100% 要维护，且 Chromium 实现坑史（CM 6.28.0–6.36.3
两年补丁：倒置选区、IME 定位、内存泄漏、Android 漏 compositionend）意味着
迁移 = 用一组已知 bug 换一组未知 bug。**触发条件**：Android Chromium 第三方键盘
反馈成为主要痛点时，按 CM gate（Chrome ≥126）+ kill switch 双路径接入，白送
收益是 `characterboundsupdate` 驱动的 IME 候选窗精确定位。

### 4. 最值得对照的源码（按贴合度）

1. `vercel-labs/wterm` `packages/@wterm/dom/src/input.ts` —— 同构度 100%
2. VS Code `src/vs/editor/browser/controller/editContext/textArea/textAreaEditContextInput.ts`
   —— textarea 状态 diff 意图推导最成熟，逐平台补丁百科
3. xterm.js `src/browser/input/CompositionHelper.ts` —— 终端 composition 终态
   提取 + 三重防重
4. CodeMirror 6 `src/input.ts` + `src/domchange.ts` —— beforeinput 语义分流与
   设备级补丁最全
5. noVNC `app/ui.js:1657-1731`（哨兵 diff 最小实现）、Guacamole `guacTextInput.js`
   （白名单 + sentText 补偿）
