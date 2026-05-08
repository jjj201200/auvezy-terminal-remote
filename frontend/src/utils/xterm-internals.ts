/**
 * xterm-internals
 *
 * xterm.js 私有内部状态访问的统一入口。集中所有 `_core.*` 私有路径，
 * 这样 xterm 升级时只改这一处。也提供常用计算 helper（client coords →
 * cell col/row、SGR mouse byte 拼接）。
 *
 * 仅本项目内部用，所有调用点在前端。
 */

/**
 * xterm Terminal 的最小子集（避免直接 import 完整类型，便于测试 mock）。
 * 字段都是 v5 / v6 稳定存在的；`_core` 是私有但所有版本都暴露在实例上。
 */
export interface XtermLike {
  cols: number;
  rows: number;
  element?: HTMLElement | undefined;
  buffer: { active: { type: 'normal' | 'alternate' } };
  /** 当前选区文本；无选区时返回空串 */
  getSelection?: () => string;
  _core?: {
    coreMouseService?: { areMouseEventsActive?: boolean };
  };
}

/**
 * TUI 是否启用了 mouse reporting（DECSET 1000/1002/1003/1006）。
 * 启用时：xterm 内部会把鼠标事件转 SGR；我们的 hook 也按此判定要不要接管。
 */
export function isMouseReportingActive(term: unknown): boolean {
  // 走 unknown 是因为 xterm Terminal 把 `_core` 标为 private，结构类型也匹配不上。
  // 这里手动断言运行时存在的字段。xterm v5 / v6 都稳定有这个路径。
  const core = (term as { _core?: { coreMouseService?: { areMouseEventsActive?: boolean } } } | null | undefined)?._core;
  return core?.coreMouseService?.areMouseEventsActive === true;
}

/**
 * 把 mousedown 事件直接喂给 xterm 内部 SelectionService，启动文本选择。
 * 用途：我们 hook 在 capture 阶段拦下 mousedown 阻止 xterm 主 handler 发 SGR
 *      （它有时会因 _renderService.dimensions undefined 崩），但仍想让用户能
 *      拖选复制——于是手动分发给 SelectionService。
 *
 * **enable trick**：mouse reporting 激活时 xterm 自动 disable() SelectionService
 * （要求 Shift+click 强制选择）。我们要无修饰键直接拖选，所以先 enable() 让
 * service 进入正常路径。enable 之后保持 enabled 不会有副作用——xterm 主 handler
 * 已经被 caller stopImmediatePropagation 拦下，不会重复处理。
 *
 * 静默失败：如果 xterm 内部结构变了或没找到 service，返回 false 不抛错。
 */
export function dispatchSelectionMouseDown(term: unknown, e: MouseEvent): boolean {
  const core = (term as {
    _core?: {
      _selectionService?: {
        enable?: () => void;
        handleMouseDown?: (ev: MouseEvent) => void;
      };
    };
  } | null | undefined)?._core;
  const svc = core?._selectionService;
  if (!svc?.handleMouseDown) return false;
  try {
    svc.enable?.(); // 强制启用：mouse reporting 时 xterm 默认 disable 它
    svc.handleMouseDown(e);
    return true;
  } catch {
    return false;
  }
}

/** 当前是否在 alt-screen（Claude TUI / vim / htop / less / tmux 等） */
export function isAltScreen(term: XtermLike | null | undefined): boolean {
  return term?.buffer.active.type === 'alternate';
}

/**
 * 把 client 坐标（鼠标 / 触摸的 pageX/pageY）换算成 xterm 内的 cell 坐标。
 * 返回 1-based col/row（SGR 协议要求 ≥1）。元素信息缺失时返回屏幕中心。
 */
export function clientToCell(
  elt: HTMLElement | undefined,
  term: XtermLike,
  clientX: number,
  clientY: number,
): { col: number; row: number } {
  if (!elt) {
    return {
      col: Math.max(1, Math.floor(term.cols / 2)),
      row: Math.max(1, Math.floor(term.rows / 2)),
    };
  }
  const rect = elt.getBoundingClientRect();
  const cellW = term.cols > 0 ? rect.width / term.cols : 8;
  const cellH = term.rows > 0 ? rect.height / term.rows : 16;
  const col = Math.max(1, Math.min(term.cols, Math.floor((clientX - rect.left) / Math.max(1, cellW)) + 1));
  const row = Math.max(1, Math.min(term.rows, Math.floor((clientY - rect.top) / Math.max(1, cellH)) + 1));
  return { col, row };
}

/** 单元格高度（px）。renderer 可能尚未就绪时回退 16。 */
export function getCellHeight(elt: HTMLElement | undefined, term: XtermLike): number {
  if (!elt || term.rows <= 0) return 16;
  return elt.getBoundingClientRect().height / term.rows;
}

/**
 * SGR 1006 mouse button code：
 *  - 0=left  1=middle  2=right
 *  - 64=wheel up  65=wheel down
 */
export type SgrButton = 0 | 1 | 2 | 64 | 65;

/**
 * 拼一段 SGR 1006 mouse 序列。
 *  - press 用大写 'M' 结尾
 *  - release 用小写 'm' 结尾
 *  - 普通点击是 press+release 一对（withRelease=true）
 *  - wheel 只发 press，不需 release
 */
export function buildSgrEvent(
  button: SgrButton,
  col: number,
  row: number,
  opts: { release?: boolean } = {},
): string {
  const press = `\x1b[<${button};${col};${row}M`;
  return opts.release ? press + `\x1b[<${button};${col};${row}m` : press;
}
