/**
 * useTerminal
 *
 * 把 xterm.js 的全部运行期复杂度封到一个 React hook，
 * 让 TerminalView 组件只是个超薄壳（容器 + ref）。
 *
 * 职责：
 *  1. xterm 实例生命周期：mount 时构造，unmount 时 dispose
 *  2. 加载三个 addons：FitAddon（必）、Unicode11Addon（graceful 降级）、
 *     WebglAddon（graceful 降级到 canvas）
 *  3. 批写入：write 入队列，三阈值（RAF / 16ms timer / 256KB）合并 flush
 *  4. resize 节流 + 去重：50ms 内合并、同尺寸不上报
 *  5. 智能 auto-follow 滚动：用户上滑暂停跟随，回到底部恢复
 *
 * 关键设计点：
 *  - 所有可变状态用 useRef，仅 showScrollHint 用 useState（驱动按钮显隐）
 *  - onResize 回调返回 false 时不更新 lastReportedResize（让重发能成功重置）
 *  - scrollEventSkipCount 计数器：每次程序滚动前 +1，吞下一次 onScroll；
 *    避免"PTY 持续输出时用户向上滑动被 onScroll 误识别为程序滚动"
 *  - RAF + setTimeout 双保险 flush：RAF 在隐藏 tab 不触发，setTimeout 兜底
 *  - cleanup 必须 cancel 所有定时器与 RAF，否则 unmount 后回调会抖
 */

import { useRef, useEffect, useState, useCallback, type RefObject } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { WebglAddon } from '@xterm/addon-webgl';
import { CanvasAddon } from '@xterm/addon-canvas';
import { SearchAddon } from '@xterm/addon-search';
import '@xterm/xterm/css/xterm.css';
import {
  XTERM_WRITE_FLUSH_INTERVAL_MS,
  XTERM_WRITE_MAX_QUEUED_BYTES,
  XTERM_SCROLLBACK_LINES,
  XTERM_FONT_SIZE,
  RESIZE_THROTTLE_MS,
} from '../config/constants.js';
import { FONT_SIZE_MIN, FONT_SIZE_MAX } from 'auvezy-terminal-remote-shared';
import { resolveTheme } from '../themes/terminal-themes.js';

/**
 * xterm 显示偏好（来自 UserConfig.display）
 *
 * - targetCols：>0 时启用自适应字号；按容器宽度反推 fontSize
 *   公式：fontSize ≈ containerWidth / targetCols / CHAR_WIDTH_RATIO
 *   等宽字体 char-width / fontSize ≈ 0.6（Geist Mono / Menlo 实测）
 * - letterSpacing：负值压缩、正值拉宽（px）
 */
export interface DisplayOpts {
  targetCols?: number;
  letterSpacing?: number;
  /** 调色板主题名；缺省 = dark (Campbell) */
  theme?: import('auvezy-terminal-remote-shared').TerminalThemeName;
}

const CHAR_WIDTH_RATIO = 0.6;

/**
 * onResize 回调返回值含义：
 *  - true / undefined：发送成功，更新 lastReportedResize
 *  - false：未发送（如 WS 离线），保持 lastReportedResize 不变让下次能重发
 */
/**
 * onResize 回调
 * @param cols / rows 目标尺寸
 * @param master 可选；true 表示此次 resize 同时声明本客户端为 PTY 主控，
 *   后端会拒绝其他客户端的非主控 resize 直到本连接断开 / 别人也声明 master
 */
export type ResizeCallback = (cols: number, rows: number, master?: boolean) => boolean | void;

export interface UseTerminalReturn {
  /** 把数据写入 xterm（批合并） */
  write: (data: string) => void;
  /** 清屏（保留 buffer） */
  clear: () => void;
  /** 完整 reset xterm */
  reset: () => void;
  /** 滚动到底部（程序触发） */
  scrollToBottom: () => void;
  /** 滚动到顶部（程序触发） */
  scrollToTop: () => void;
  /** 设置 auto-follow 开关 */
  setAutoFollow: (enabled: boolean) => void;
  /** 是否显示"返回底部"按钮（绑定到组件 state） */
  showScrollHint: boolean;
  /** 让 xterm 与 PTY 尺寸对齐（history_sync 后调用） */
  adaptToPtySize: (cols: number, rows: number) => void;
  /**
   * 强制按当前容器尺寸 fit + 上报 PTY，绕过键盘冻结 / 防抖逻辑。
   * 用于"用户主动点击 → 让此设备主导 PTY cols"场景（多端共连时切换主控）。
   */
  adaptToDevice: () => void;
  /** 在缓冲区里搜索，跳到下一处匹配 */
  searchNext: (term: string, opts?: SearchOpts) => boolean;
  /** 在缓冲区里搜索，跳到上一处匹配 */
  searchPrev: (term: string, opts?: SearchOpts) => boolean;
  /** 清除搜索高亮 */
  clearSearch: () => void;
  /** 获取当前选区文本，无选区返回空串 */
  getSelection: () => string;
  /**
   * 注册 xterm 的 onData 回调（键盘 / paste / IME 输出统一从这里出）。
   * 调用方传 null 取消注册。直接输入模式下用它把按键实时发给 PTY。
   */
  setOnData: (cb: ((data: string) => void) | null) => void;
  /** 内部 Terminal 引用（极少数高级场景使用） */
  terminal: RefObject<Terminal | null>;
}

export interface SearchOpts {
  caseSensitive?: boolean;
  wholeWord?: boolean;
  regex?: boolean;
}

export function useTerminal(
  containerRef: RefObject<HTMLDivElement | null>,
  onResize?: ResizeCallback,
  display?: DisplayOpts,
): UseTerminalReturn {
  // ──────────────── refs ────────────────
  const termRef = useRef<Terminal | null>(null);
  // 直接输入模式下的 onData 回调；setOnData 切换它而不重挂 xterm listener
  const onDataRef = useRef<((data: string) => void) | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const searchAddonRef = useRef<SearchAddon | null>(null);

  // 镜像 display 偏好（避免重建 xterm；ResizeObserver 也读这个 ref）
  const displayRef = useRef<DisplayOpts | undefined>(display);
  displayRef.current = display;
  // applyPrefs 的指针：xterm 初始化时填，display 变化的 effect 调
  const applyPrefsRef = useRef<(() => void) | null>(null);

  // 镜像 prop：避免 onResize 变化导致整个 xterm 重建
  const onResizeRef = useRef<ResizeCallback | undefined>(onResize);
  onResizeRef.current = onResize;

  // 写入批合并队列
  const writeQueueRef = useRef<string[]>([]);
  const writeQueueBytesRef = useRef(0);
  const writeRafIdRef = useRef<number | null>(null);
  const writeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // resize 节流 + 去重
  const lastResizeAtRef = useRef(0);
  const pendingResizeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingResizeValueRef = useRef<{ cols: number; rows: number } | null>(null);
  const lastReportedResizeRef = useRef<{ cols: number; rows: number } | null>(null);

  // auto-follow 滚动
  const autoFollowRef = useRef(true);
  const isAtBottomRef = useRef(true);
  /**
   * 程序触发滚动时设此计数为 1，吞下下一次 onScroll；
   * 避免误把"程序 scrollToBottom 触发的 onScroll"当作"用户滚动"
   */
  const scrollSkipRef = useRef(0);
  const scrollRafIdRef = useRef<number | null>(null);
  const [showScrollHint, setShowScrollHint] = useState(false);

  // ──────────────── 内部辅助 ────────────────

  /** 把 writeQueueRef 里的内容一次性 term.write */
  const flushWriteQueue = useCallback(() => {
    if (!termRef.current || writeQueueRef.current.length === 0) return;
    const merged = writeQueueRef.current.join('');
    writeQueueRef.current = [];
    writeQueueBytesRef.current = 0;
    termRef.current.write(merged);
  }, []);

  /** auto-follow 开启时滚到底部，否则只检测按钮显隐 */
  const autoScrollIfNeeded = useCallback(() => {
    const term = termRef.current;
    if (!term) return;
    if (autoFollowRef.current) {
      // 程序滚动 — 先打跳过标记
      scrollSkipRef.current = 1;
      scrollRafIdRef.current = requestAnimationFrame(() => {
        scrollRafIdRef.current = null;
      });
      term.scrollToBottom();
      return;
    }
    // auto-follow 关闭：仅检测是否需要显示按钮
    const buf = term.buffer.active;
    const atBottom = buf.viewportY === buf.length - term.rows;
    if (atBottom !== isAtBottomRef.current) {
      isAtBottomRef.current = atBottom;
      setShowScrollHint(!atBottom);
    }
  }, []);

  /** 上报 resize 到外部（带节流 + 去重） */
  const emitResize = useCallback((cols: number, rows: number) => {
    const last = lastReportedResizeRef.current;
    if (last && last.cols === cols && last.rows === rows) return;

    const now = Date.now();
    const elapsed = now - lastResizeAtRef.current;

    const fire = (): void => {
      lastResizeAtRef.current = Date.now();
      const sent = onResizeRef.current?.(cols, rows);
      if (sent !== false) {
        lastReportedResizeRef.current = { cols, rows };
      }
    };

    if (elapsed >= RESIZE_THROTTLE_MS) {
      fire();
      return;
    }

    // 节流窗口内：合并到 pending，最后一次 setTimeout 后发出
    pendingResizeValueRef.current = { cols, rows };
    if (!pendingResizeTimeoutRef.current) {
      pendingResizeTimeoutRef.current = setTimeout(() => {
        pendingResizeTimeoutRef.current = null;
        const pending = pendingResizeValueRef.current;
        pendingResizeValueRef.current = null;
        if (pending) {
          lastResizeAtRef.current = Date.now();
          const sent = onResizeRef.current?.(pending.cols, pending.rows);
          if (sent !== false) {
            lastReportedResizeRef.current = { cols: pending.cols, rows: pending.rows };
          }
        }
      }, RESIZE_THROTTLE_MS - elapsed);
    }
  }, []);

  // ──────────────── xterm 生命周期 ────────────────

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // 抑制 xterm 5.x 的已知偶发报错：
    //   "Cannot read properties of undefined (reading 'dimensions')"
    //   (RenderService.ts -> Viewport.syncScrollArea)
    // 触发场景：容器在 React portal mount/unmount、Sheet/Dialog 打开关闭、
    //          或浏览器 reflow 时，xterm 内部异步访问 _renderService.dimensions
    //          那一刻 dimensions 还没 realloc。
    // 我们在 ResizeObserver 链里已加 try-catch，但 xterm 内部还有 RAF / timer
    // 触发的同名访问，覆盖不到。这条全局拦截只针对这一个特定 message，不会吞掉别的错。
    const errorSuppressor = (e: ErrorEvent): void => {
      if (
        e.error instanceof TypeError &&
        e.error.message.includes("reading 'dimensions'") &&
        (e.filename?.includes('xterm') ||
          e.error.stack?.includes('RenderService') ||
          e.error.stack?.includes('Viewport'))
      ) {
        e.preventDefault(); // 阻止控制台红字
        e.stopImmediatePropagation();
      }
    };
    window.addEventListener('error', errorSuppressor);

    /**
     * 根据 display 偏好 + 容器宽度，算出 fontSize / letterSpacing
     *
     * - targetCols > 0：自适应字号；fontSize ≈ width / targetCols / CHAR_WIDTH_RATIO
     *   减去 letterSpacing 的影响（每个字宽多了 letterSpacing px），夹紧到 [8, 18]
     * - targetCols 缺失 / 0：用默认字号
     * - letterSpacing：原值透传（已在 UI 限范围）
     */
    const computeFontPrefs = (): { fontSize: number; letterSpacing: number } => {
      const d = displayRef.current;
      const ls = d?.letterSpacing ?? 0;
      const targetCols = d?.targetCols ?? 0;
      if (!targetCols || targetCols <= 0) {
        return { fontSize: XTERM_FONT_SIZE, letterSpacing: ls };
      }
      const width = container.clientWidth;
      if (width <= 0) return { fontSize: XTERM_FONT_SIZE, letterSpacing: ls };
      // (fontSize * CHAR_WIDTH_RATIO + ls) * targetCols ≈ width
      const raw = (width / targetCols - ls) / CHAR_WIDTH_RATIO;
      const clamped = Math.max(FONT_SIZE_MIN, Math.min(FONT_SIZE_MAX, Math.floor(raw)));
      return { fontSize: clamped, letterSpacing: ls };
    };

    const initial = computeFontPrefs();
    const term = new Terminal({
      // disableStdin=false：让 xterm 自己监听 helper-textarea 的 keydown/input
      // 事件并触发 onData。我们通过 setOnData(cb) 决定是否转发到 PTY：
      //   - useInputBar=true: setOnData(null)，xterm 内部仍处理（但 helper
      //     pointer-events:none，焦点永远在我们的 InputBar，所以 xterm 实际
      //     收不到键 → onData 不触发）
      //   - useInputBar=false: setOnData(send → WS)，焦点在 helper-textarea，
      //     用户按键 / IME 输入 → xterm.onData → 直发 PTY
      disableStdin: false,
      // SearchAddon 用 registerDecoration 画匹配高亮，xterm 把它归为 proposed API
      allowProposedApi: true,
      fontSize: initial.fontSize,
      letterSpacing: initial.letterSpacing,
      // 字体栈：开发者最常用的等宽 + 中英对齐
      // 英文优先级：Geist Mono(自带woff2) > JetBrains Mono > Fira Code > Cascadia Code
      //   > 系统等宽（macOS/Win/Linux 各自的 SF Mono / Consolas / DejaVu）
      // 中文等宽优先级：Sarasa Mono SC / Maple Mono CN（社区主流"中英 1:2 等宽"）
      //   > 系统中文无衬线（PingFang / HarmonyOS / 雅黑 / Noto Sans CJK）
      // 没装的字体浏览器静默跳过，不影响其他字符。绝对不让 SimSun / 宋体 衬线
      // 字体进入 fallback —— 始终保持无衬线视觉。
      fontFamily: [
        // === 英文等宽 ===
        "'Geist Mono'",          // 项目自带 woff2，移动端首屏可用
        "'JetBrains Mono'",      // 开发者机器最常装
        "'Fira Code'",           // 开发者圈广泛使用
        "'Cascadia Code'",       // Windows Terminal 默认
        'ui-monospace',          // macOS Big Sur+ 系统等宽
        "'SF Mono'",             // macOS 系统等宽
        'Menlo',                 // macOS 老版本兜底
        'Consolas',              // Windows 系统等宽
        "'DejaVu Sans Mono'",    // Linux 通用
        // === 中文等宽（用户装了才用，1:2 对齐严格）===
        "'Sarasa Mono SC'",      // 更纱黑体，最受推崇
        "'Sarasa Mono SC Nerd'", // 带 nerd-font icon 的变体
        "'Maple Mono CN'",       // Maple Mono 中文版
        "'JetBrains Mono CJK'",  // 社区改的 JetBrains Mono CJK 变体
        // === 中文无衬线 fallback（不严格等宽，但保证不出衬线字体）===
        "'PingFang SC'",
        "'HarmonyOS Sans SC'",
        "'Microsoft YaHei UI'",
        "'Microsoft YaHei'",
        "'Source Han Sans SC'",
        "'Noto Sans Mono CJK SC'",
        "'Noto Sans SC'",
        // === 最终兜底 ===
        'monospace',
      ].join(', '),
      scrollback: XTERM_SCROLLBACK_LINES,
      // 配色：One Dark / Atom 风格，介于 GitHub Dark 与 Tango 之间的中等饱和度
      // 调色板由 themes/terminal-themes.ts 统一管理，按 display.theme 查表。
      // 默认 'dark' = Campbell（Windows Terminal / PowerShell 默认）。
      // 主题列表跟 Claude Code /theme 命令对齐。
      theme: resolveTheme(display?.theme),
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);

    const searchAddon = new SearchAddon();
    term.loadAddon(searchAddon);
    searchAddonRef.current = searchAddon;

    // Unicode11 graceful 降级
    try {
      const u = new Unicode11Addon();
      term.loadAddon(u);
      term.unicode.activeVersion = '11';
    } catch {
      /* fallback to default unicode width */
    }

    term.open(container);

    // ──────────────── iOS 兼容：抑制 helper-textarea 的预测输入污染 ────────────────
    //
    // xterm 内部创建的 .xterm-helper-textarea 默认没有禁用 iOS WebKit 的
    // predictive text / autocorrect / autocapitalize。iOS 的预测输入会把
    // 候选词提前 input 进 textarea，xterm 当作真实按键发到 PTY。对 Claude
    // Code（基于 Ink，相对坐标重画 + 不进 alt-screen）杀伤巨大：非预期字符
    // 触发 React 状态变更 → 整树 re-render → 在错位画面上又画一遍 → 视觉混乱。
    //
    // xterm 没暴露公共 API 配置 helper-textarea 属性，只能 DOM 查询后设置。
    // 同时设 inputmode="none" 让 xterm 自己用 onKey 路径，避免 IME composition
    // 把候选词回灌（直接输入模式我们用自挂的 DirectInputCapture 接 IME）。
    const helperTextarea = container.querySelector<HTMLTextAreaElement>('.xterm-helper-textarea');
    if (helperTextarea) {
      helperTextarea.setAttribute('autocomplete', 'off');
      helperTextarea.setAttribute('autocorrect', 'off');
      helperTextarea.setAttribute('autocapitalize', 'off');
      helperTextarea.setAttribute('spellcheck', 'false');
    }

    // ──────────────── 移动端单指 swipe → 滚动 scrollback ────────────────
    //
    // 原因：xterm 默认依赖 wheel 事件滚动 viewport，触屏拖拽不会触发 wheel。
    // 原生 viewport 的 overflow:auto 在 webgl 渲染下也基本无效（GPU 自己画
    // canvas，scrollHeight 为 0）。所以手动监听 touchstart/touchmove，把垂直
    // 位移按 cell 高度换算成行数，调 term.scrollLines()。
    //
    // 仅响应"主屏幕"（!buffer.alternate）：alt-screen 是 TUI 程序自己的画布，
    // 滚 xterm 会让程序视图错位；alt-screen 内的滚动应该是程序自己接管
    // （vim Ctrl+B / less b 等），未来如需要可加 wheel-report 转发。
    //
    // 多指 / 选中文本场景跳过：避免与 xterm 的选中 / pinch zoom 等冲突
    let touchStartY = 0;
    let touchAccumPx = 0;
    let touchPointerId: number | null = null;
    const onTouchStart = (e: TouchEvent): void => {
      if (e.touches.length !== 1) {
        touchPointerId = null;
        return;
      }
      const isAlt = term.buffer.active.type === 'alternate';
      const buf = term.buffer.active;
      // eslint-disable-next-line no-console
      console.log('[TS] touchstart', JSON.stringify({
        bufType: buf.type,
        isAlt,
        bufLength: buf.length,
        viewportY: buf.viewportY,
        baseY: buf.baseY,
        rows: term.rows,
      }));
      // alt-screen 不接管
      if (isAlt) {
        touchPointerId = null;
        return;
      }
      touchPointerId = e.touches[0]!.identifier;
      touchStartY = e.touches[0]!.clientY;
      touchAccumPx = 0;
    };
    const onTouchMove = (e: TouchEvent): void => {
      if (touchPointerId === null) return;
      // 找到本次 swipe 的 touch；多指中途插入则放弃
      const t = Array.from(e.touches).find((x) => x.identifier === touchPointerId);
      if (!t) return;
      // 选中文本时不接管（让 xterm / 浏览器处理选区）
      const sel = window.getSelection();
      if (sel && sel.toString().length > 0) return;

      const dy = t.clientY - touchStartY;
      const newDelta = dy - touchAccumPx;
      // 把 px 累积到至少 1 个 cell 高才滚一行（减少抖动）
      const cellH = (term as unknown as { _core?: { _renderService?: { dimensions?: { css?: { cell?: { height?: number } } } } } })
        ._core?._renderService?.dimensions?.css?.cell?.height ?? 18;
      if (Math.abs(newDelta) < cellH) return;
      const lines = Math.trunc(newDelta / cellH);
      if (lines === 0) return;
      // 手指下拉(dy>0) → 看历史(scrollLines 负数)
      // eslint-disable-next-line no-console
      console.log('[TS] scrollLines', JSON.stringify({
        lines: -lines,
        beforeViewportY: term.buffer.active.viewportY,
        bufLength: term.buffer.active.length,
      }));
      term.scrollLines(-lines);
      touchAccumPx += lines * cellH;
      // 阻止默认避免页面整体被拖动 / iOS 弹性回弹
      e.preventDefault();
    };
    const onTouchEnd = (): void => {
      touchPointerId = null;
    };
    // touchmove 必须 passive:false 才能 preventDefault
    container.addEventListener('touchstart', onTouchStart, { passive: true });
    container.addEventListener('touchmove', onTouchMove, { passive: false });
    container.addEventListener('touchend', onTouchEnd, { passive: true });
    container.addEventListener('touchcancel', onTouchEnd, { passive: true });

    // 渲染器三档：
    //  - 桌面（非 iOS）：WebGL，最快、字符按 fontSize × 1.0 精确自绘
    //  - iOS：Canvas 2D（addon-canvas），跟 WebGL 同样自绘字符，避开 DOM renderer
    //    的字体度量歧义（iOS DOM cell.height 比桌面 WebGL 高 5-7px 视觉松散），
    //    同时绕开 WebGL 在 iOS 的两个痛点：
    //      * GPU 上下文丢失（键盘弹起 / sleep-resume 后纹理 stale）
    //      * rAF 限流期 alt-screen TUI 丢帧
    //  - WebglAddon 与 SearchAddon decoration 不兼容（已规避，不传 decorations
    //    只用 term.select() 渲染当前匹配）
    //
    // 都失败时 xterm 自动 fallback DOM renderer。
    //
    // iOS 检测：navigator.platform === 'MacIntel' && maxTouchPoints>1 是
    // iPadOS 13+ 把 UA 报成 Mac 后的兜底
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    if (isIOS) {
      try {
        term.loadAddon(new CanvasAddon());
      } catch {
        /* DOM renderer 是默认 fallback */
      }
    } else {
      try {
        const webgl = new WebglAddon();
        webgl.onContextLoss(() => webgl.dispose());
        term.loadAddon(webgl);
      } catch {
        /* DOM renderer 是默认 fallback */
      }
    }

    // 容器可能 hidden（多实例下非 active 实例 display:none），fit 抛异常 → 让 ResizeObserver 兜底
    try {
      fitAddon.fit();
    } catch {
      /* 容器尺寸为 0：等切到可见时 ResizeObserver 自愈 */
    }
    // 挂载稳定窗：移动端首屏 safe-area / 字体加载 / Toolbar lazy 渲染会让
    // terminalWrap 尺寸在 ~1.5s 内反复跳变。更关键的是 xterm 的 cellHeight
    // 依赖等宽字体加载完成才能算准——字体未加载时 fit 算出的 rows 偏少
    // (实测 27)，字体加载完才正确 (43)。
    //
    // 用 document.fonts.ready 等字体真正可用，再 fit + emit。fonts.ready 没
    // 履行时退回 INITIAL_QUIET_MS（保底）。
    const INITIAL_QUIET_MS = 1500;
    let initialQuiet = true;
    const finishInitialQuiet = (): void => {
      if (!initialQuiet) return;
      initialQuiet = false;
      try { fitAddon.fit(); } catch { /* 等下次 ResizeObserver */ }
      if (termRef.current) scheduleEmit(term.cols, term.rows);
    };
    if (document.fonts && typeof document.fonts.ready?.then === 'function') {
      void document.fonts.ready.then(finishInitialQuiet);
    }
    // 兜底：fonts.ready 不支持 / 永远不解析 → INITIAL_QUIET_MS 后强制结束
    setTimeout(finishInitialQuiet, INITIAL_QUIET_MS);

    termRef.current = term;
    fitAddonRef.current = fitAddon;

    // 容器尺寸变化 → fit + 上报
    //
    // 防御：
    //  - 容器宽/高为 0 时跳过（Sheet/Dialog 打开瞬间 / display:none 路径会触发）
    //  - try/catch 兜底 xterm 内部 RenderService dimensions 偶发未就绪：抛错不能传出
    //    ResizeObserver 回调，否则浏览器会把 observer 从 entries 清掉，之后 fit 永远不再触发
    /**
     * 重应用显示偏好（字号 / letterSpacing）
     *
     * 调用时机：
     *  - 容器尺寸变化（targetCols 模式下，宽度变化要重算字号）
     *  - 用户在设置里改了 display 偏好（触发 effect → applyPrefs）
     *
     * 改动 fontSize/letterSpacing 后必须 fit() 让 cols/rows 与新字号同步，
     * 然后上报 resize 给后端 PTY。
     */
    const applyPrefs = (): void => {
      const next = computeFontPrefs();
      const opts = term.options;
      let changed = false;
      if (opts.fontSize !== next.fontSize) {
        opts.fontSize = next.fontSize;
        changed = true;
      }
      if ((opts.letterSpacing ?? 0) !== next.letterSpacing) {
        opts.letterSpacing = next.letterSpacing;
        changed = true;
      }
      // theme 切换无需重建 xterm —— 直接赋值 options.theme 即可触发重绘
      const nextTheme = resolveTheme(display?.theme);
      opts.theme = nextTheme;
      if (changed) {
        try {
          fitAddon.fit();
        } catch {
          /* xterm RenderService 偶发未就绪：下一帧 ResizeObserver 自愈 */
        }
      }
    };
    applyPrefsRef.current = applyPrefs;

    // ──────────────── resize → PTY 防抖（参考 VS Code TerminalResizeDebouncer）────────────────
    //
    // 桌面端无此问题，移动端（特别是 iOS WebKit / iOS Chrome）软键盘弹起会让
    // visualViewport 抖动 → 容器高度从 ~45 行压缩到 ~5 行再恢复，期间
    // ResizeObserver 高频回调。每次都 fit + emit 给 PTY 的话：
    //  - PTY 的 cols 在 10/45/70 之间狂跳
    //  - zsh + autosuggestions 按多个不同 cols 反复重画 prompt
    //  - 残留行擦不掉 → 视觉上"堆积"
    //
    // 第一道防御（CSS 平台层）：index.html 的 viewport meta 加了
    // `interactive-widget=resizes-visual`，Chromium 系（含 Android Chrome）键盘
    // 弹起只压 visual viewport 不动 layout viewport → ResizeObserver 根本不触发。
    // iOS 上所有浏览器底层强制 WebKit，meta 不生效，下面的 JS 兜底。
    //
    // 第二道防御（JS 三件套）：
    //  1. 入口去重：cols/rows 跟上次 emit 的相同直接 short-circuit
    //  2. 防抖 300ms：连续抖动只在最终稳态 emit 一次。300ms 足以等到 iOS 软
    //     键盘动画结束（约 250ms），又不让用户感觉到延迟
    //  3. 键盘冻结：visualViewport.height < 75% innerHeight 视为键盘弹起，
    //     期间完全跳过 fit + emit；键盘收起的 visualViewport.resize 会触发
    //     新一轮 fit 走正常路径
    //  4. 最小尺寸阈值：cols<20 / rows<8 直接丢弃（xterm font metrics 未就绪
    //     时偶发瞬态垃圾值，emit 后污染 PTY）
    const COLS_DEBOUNCE_MS = 300;
    let colsDebounceTimer: ReturnType<typeof setTimeout> | null = null;
    let pendingCols = 0;
    let pendingRows = 0;
    let lastEmittedCols = 0;
    let lastEmittedRows = 0;

    /** 软键盘弹起检测（仅 visualViewport 可用时） */
    const isKeyboardOpen = (): boolean => {
      const vv = window.visualViewport;
      if (!vv) return false;
      return vv.height < window.innerHeight * 0.75;
    };

    /** 真正下发 SIGWINCH 给 PTY，做入口去重 */
    const tryEmit = (cols: number, rows: number): void => {
      if (cols === lastEmittedCols && rows === lastEmittedRows) return;
      lastEmittedCols = cols;
      lastEmittedRows = rows;
      emitResize(cols, rows);
    };

    // 最小可用尺寸：zsh + autosuggestions 在极小 cols/rows 下 CUU/EL 必出错；
    // 容器尺寸瞬态过小（xterm font metrics 未就绪时偶发 cols=10 r=5）的 emit
    // 会污染 PTY，下一帧恢复正常尺寸时 zsh 已经按错位 cols 重画过 prompt
    const MIN_USABLE_COLS = 20;
    const MIN_USABLE_ROWS = 8;

    /** 按 VS Code 策略调度：所有变化都防抖到 COLS_DEBOUNCE_MS 后一次 emit */
    const scheduleEmit = (cols: number, rows: number): void => {
      // 太小的尺寸直接丢弃（不缓存到 pending，避免防抖回调拿到旧的小值）
      if (cols < MIN_USABLE_COLS || rows < MIN_USABLE_ROWS) return;
      // 初始挂载窗口 + 键盘弹起期：完全冻结 emit，只缓存意图
      if (isKeyboardOpen() || initialQuiet) {
        pendingCols = cols;
        pendingRows = rows;
        return;
      }
      pendingCols = cols;
      pendingRows = rows;
      // 不再分横纵：实测 zsh-autosuggestions 在 rows 变化时也会重画 prompt
      // 导致残留堆积，所以 rows 也走防抖。100ms 内的连续变化合并成一次 emit
      if (colsDebounceTimer) clearTimeout(colsDebounceTimer);
      colsDebounceTimer = setTimeout(() => {
        colsDebounceTimer = null;
        tryEmit(pendingCols, pendingRows);
      }, COLS_DEBOUNCE_MS);
    };

    /**
     * fit + scheduleEmit 的统一入口。
     *
     * 关键：fit() 不只算尺寸，还会真的修改 term.rows / term.cols 和重排 buffer。
     * 键盘弹起期 / 初始 quiet 期跳过 fit()，让 xterm 维持上次稳定 rows，使
     * zsh 的 CUU/EL 等"原地刷新"序列在大 buffer 内正常工作（buffer 行数 =
     * term.rows，必须够大才能容下 zsh-autosuggestions 的 N 行提示 + 上移 N 行）。
     * CSS 容器临时被键盘压小不影响 buffer，用户能滚动看到溢出部分。
     */
    // 跟踪"键盘关闭时的稳态高度"，用于检测"容器突然变小是否是键盘弹起导致"。
    // ResizeObserver 跟 visualViewport.resize 在 iOS 上事件顺序不固定：可能
    // ResizeObserver 先触发（容器已被键盘 padding 压扁），但 vv 还没 update，
    // 此时 isKeyboardOpen() 仍返回 false → fit() 把 xterm 按缩小后的容器算
    // 出错位 rows。
    // 解法：记录最近一次"键盘关闭态"的容器高度，如果当前 h 明显比那个值小，
    // 认为是键盘正在弹起的过渡帧，跳过 fit（即使 isKeyboardOpen 还没确认）
    let stableHeight = 0;
    const SHRINK_THRESHOLD = 0.7;

    const fitAndSchedule = (): void => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (w === 0 || h === 0) return;
      // 初始挂载期：跳过 fit，避免拿到 xterm font metrics 未就绪的瞬态垃圾尺寸
      if (initialQuiet) {
        return;
      }
      // 键盘正在弹起的过渡帧（容器已被压扁但 vv 还没 update）：跳过 fit，
      // 等 vv 真正 update 后由 onVvResize 再驱动一次 fit
      if (stableHeight > 0 && h < stableHeight * SHRINK_THRESHOLD && !isKeyboardOpen()) {
        return;
      }
      try {
        applyPrefs();
        fitAddon.fit();
        // 键盘弹起期：fit 仍跑（让 xterm 内部 rows 跟 CSS 容器对齐，避免内容
        // 被 overflow:hidden 裁掉看起来"消失"），但 emit 冻结（scheduleEmit
        // 内部判定 isKeyboardOpen → 只缓存 pendingCols/Rows 不发 PTY），等键
        // 盘收起再一次性 emit 稳定值，避免抖动期 PTY cols 狂跳
        scheduleEmit(term.cols, term.rows);
        // 只在非键盘态记录 stableHeight，键盘期的小高度不应作为后续判定基准
        if (!isKeyboardOpen()) {
          stableHeight = h;
        }
      } catch {
        // xterm RenderService 偶发 dimensions undefined（容器 portal 切换时序）
        // 下一帧再次触发 ResizeObserver 时会自愈
      }
    };

    const resizeObserver = new ResizeObserver(() => {
      fitAndSchedule();
    });

    // visualViewport 变化（键盘弹起 / 收起 / 旋屏）→ 复用同一 fit 路径，
    // 同时键盘刚弹起时把 xterm viewport 滚到底部，确保当前命令行 / 光标在
    // 缩小的 CSS 可视区里能看到（buffer 不变但 viewport 变小，autoFollow 还
    // 没触发就先主动滚一下）
    let prevKbOpen = false;
    const onVvResize = (): void => {
      requestAnimationFrame(() => {
        const vv = window.visualViewport;
        const cont = container;
        const kbOpenNow = isKeyboardOpen();
        const kbJustClosed = prevKbOpen && !kbOpenNow;
        // eslint-disable-next-line no-console
        console.log('[VV] resize', JSON.stringify({
          vvH: vv?.height,
          innerH: window.innerHeight,
          ratio: vv ? +(vv.height / window.innerHeight).toFixed(2) : null,
          contH: cont.clientHeight,
          stableH: stableHeight,
          kbOpen: kbOpenNow,
          kbJustClosed,
          termRows: termRef.current?.rows,
        }));
        fitAndSchedule();
        // 键盘刚收起：fitAndSchedule 已把 term.rows 重新算成大尺寸（容器恢复
        // 后 fit 自然给出新值），但 emit 走 300ms 防抖，且 Claude 等 TUI 在
        // 防抖期间已 idle，不会主动重画下面空出来的行。
        //
        // 仅"立即 emit (cols, rows)"无效——Linux kernel tty_do_resize 在 winsize
        // 跟之前一样时短路，不投递 SIGWINCH（之前键盘期可能已 emit 过这个尺寸，
        // 或本次防抖前的 ResizeObserver 已 emit）。
        //
        // 方案 A：先 emit (cols, rows-1) 让 kernel 真的投递 SIGWINCH（rows 跟
        // 上次不同），下一帧再 emit (cols, rows)。两次 size 不同，TUI 触发两次
        // SIGWINCH handler → ink 的 layout reflow + full repaint，下方空白被填满。
        // 参考：Linux SIGWINCH 行为 + ink #907 / Claude Code #49086 上游 bug
        if (kbJustClosed) {
          if (colsDebounceTimer) {
            clearTimeout(colsDebounceTimer);
            colsDebounceTimer = null;
          }
          const t = termRef.current;
          if (t && t.cols >= MIN_USABLE_COLS && t.rows >= MIN_USABLE_ROWS + 1) {
            const targetCols = t.cols;
            const targetRows = t.rows;
            // 同步连发两次 emit：让 kernel 投递两次 SIGWINCH（rows-1 和 rows
            // 不同所以都会投递）。xterm renderer 在同一 microtask 内的两次
            // resize 通常合并到同一渲染帧，用户看不到中间的"少 1 行"过渡。
            // PTY 那边 zsh/Claude 收到两次 SIGWINCH 还是会两次 reflow，但因为
            // 浏览器渲染只画最终态，闪烁被合并掉
            // eslint-disable-next-line no-console
            console.log('[VV] kbJustClosed → wake TUI sync', JSON.stringify({
              cols: targetCols, rows: targetRows,
            }));
            tryEmit(targetCols, targetRows - 1);
            tryEmit(targetCols, targetRows);
          }
        }
        if (kbOpenNow && autoFollowRef.current) {
          scrollSkipRef.current = 1;
          termRef.current?.scrollToBottom();
        }
        prevKbOpen = kbOpenNow;
      });
    };
    window.visualViewport?.addEventListener('resize', onVvResize);
    resizeObserver.observe(container);
    // 同时观察 parent：FitAddon 实际读取的是 .xterm 的 parentElement (即
    // container) 的 getComputedStyle.height。在 SearchBar 作为 flex 兄弟出现 /
    // 消失时 container 自身高度也跟着变会触发 ResizeObserver，但少数浏览器对
    // absolute + flex 子项的回调有时序差，多观察一层做兜底
    if (container.parentElement) {
      resizeObserver.observe(container.parentElement);
    }

    // 输入转发（直接输入模式）：xterm 的 onData 把所有用户输入（按键、IME 提交、
    // paste）合并成一个字符串流；调用方注册 setOnData(cb) 后，这里把 data 转给 cb。
    // 只挂一次 listener；onDataRef.current 在 setOnData 调用时切换，无需重挂
    const onDataDispose = term.onData((data: string) => {
      onDataRef.current?.(data);
    });

    // 滚动监听：智能 auto-follow
    const onScrollDispose = term.onScroll(() => {
      if (scrollSkipRef.current > 0) {
        scrollSkipRef.current--;
        return;
      }
      const buf = term.buffer.active;
      const atBottom = buf.viewportY === buf.length - term.rows;
      isAtBottomRef.current = atBottom;
      if (!atBottom && autoFollowRef.current) {
        autoFollowRef.current = false;
      }
      setShowScrollHint(!autoFollowRef.current && !atBottom);
    });

    return () => {
      window.removeEventListener('error', errorSuppressor);
      container.removeEventListener('touchstart', onTouchStart);
      container.removeEventListener('touchmove', onTouchMove);
      container.removeEventListener('touchend', onTouchEnd);
      container.removeEventListener('touchcancel', onTouchEnd);
      if (colsDebounceTimer) {
        clearTimeout(colsDebounceTimer);
        colsDebounceTimer = null;
      }
      window.visualViewport?.removeEventListener('resize', onVvResize);
      resizeObserver.disconnect();
      onScrollDispose.dispose();
      onDataDispose.dispose();

      // 清理所有挂起的定时器与 RAF
      if (pendingResizeTimeoutRef.current) {
        clearTimeout(pendingResizeTimeoutRef.current);
        pendingResizeTimeoutRef.current = null;
      }
      if (writeRafIdRef.current !== null) {
        cancelAnimationFrame(writeRafIdRef.current);
        writeRafIdRef.current = null;
      }
      if (writeTimeoutRef.current) {
        clearTimeout(writeTimeoutRef.current);
        writeTimeoutRef.current = null;
      }
      if (scrollRafIdRef.current !== null) {
        cancelAnimationFrame(scrollRafIdRef.current);
        scrollRafIdRef.current = null;
      }

      // 最后 flush 一次（避免数据丢失）
      flushWriteQueue();
      term.dispose();
      termRef.current = null;
      fitAddonRef.current = null;
      searchAddonRef.current = null;
    };
  }, [containerRef, emitResize, flushWriteQueue]);

  // 用户在设置里改了 display 偏好 → 立即重应用 + 上报新尺寸
  // 用 stringify 比较避免 useUserConfig 每次返回新对象引用导致重复 fire
  const displayKey = `${display?.targetCols ?? 0}|${display?.letterSpacing ?? 0}|${display?.theme ?? 'auto'}`;
  useEffect(() => {
    applyPrefsRef.current?.();
    const term = termRef.current;
    if (term) emitResize(term.cols, term.rows);
  }, [displayKey, emitResize]);

  // theme=auto 时跟随系统亮暗切换 → 监听 prefers-color-scheme 变化重应用
  useEffect(() => {
    if (display?.theme !== 'auto' && display?.theme !== undefined) return;
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (): void => applyPrefsRef.current?.();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [display?.theme]);

  // ──────────────── 公共 API ────────────────

  const write = useCallback((data: string): void => {
    if (!data) return;

    writeQueueRef.current.push(data);
    writeQueueBytesRef.current += data.length;

    // 阈值 1：超过最大队列字节 → 立即 flush
    if (writeQueueBytesRef.current >= XTERM_WRITE_MAX_QUEUED_BYTES) {
      flushWriteQueue();
      autoScrollIfNeeded();
      return;
    }

    // 阈值 2：RAF 调度 flush（屏幕可见时优先级最高）
    if (writeRafIdRef.current === null) {
      writeRafIdRef.current = requestAnimationFrame(() => {
        writeRafIdRef.current = null;
        if (writeTimeoutRef.current) {
          clearTimeout(writeTimeoutRef.current);
          writeTimeoutRef.current = null;
        }
        flushWriteQueue();
        autoScrollIfNeeded();
      });
    }

    // 阈值 3：setTimeout 兜底（隐藏 tab 时 RAF 不触发）
    if (!writeTimeoutRef.current) {
      writeTimeoutRef.current = setTimeout(() => {
        writeTimeoutRef.current = null;
        flushWriteQueue();
        autoScrollIfNeeded();
      }, XTERM_WRITE_FLUSH_INTERVAL_MS);
    }
  }, [flushWriteQueue, autoScrollIfNeeded]);

  const clear = useCallback(() => {
    termRef.current?.clear();
  }, []);

  const reset = useCallback(() => {
    termRef.current?.reset();
  }, []);

  const scrollToBottom = useCallback(() => {
    const term = termRef.current;
    if (!term) return;
    scrollSkipRef.current = 1;
    scrollRafIdRef.current = requestAnimationFrame(() => {
      scrollRafIdRef.current = null;
    });
    term.scrollToBottom();
  }, []);

  const scrollToTop = useCallback(() => {
    const term = termRef.current;
    if (!term) return;
    // 跟 scrollToBottom 同样吞一次 onScroll 事件，避免被识别为"用户滚动"
    scrollSkipRef.current = 1;
    scrollRafIdRef.current = requestAnimationFrame(() => {
      scrollRafIdRef.current = null;
    });
    term.scrollToTop();
  }, []);

  const setAutoFollow = useCallback((enabled: boolean) => {
    autoFollowRef.current = enabled;
    if (enabled) setShowScrollHint(false);
  }, []);

  const setOnData = useCallback((cb: ((data: string) => void) | null): void => {
    onDataRef.current = cb;
  }, []);

  const adaptToPtySize = useCallback((_cols: number, _rows: number): void => {
    const fit = fitAddonRef.current;
    const term = termRef.current;
    if (!fit || !term) return;
    fit.fit();
    // 主动上报当前 xterm 实际尺寸——这才是 PTY 应该跟随的尺寸
    emitResize(term.cols, term.rows);
  }, [emitResize]);

  const adaptToDevice = useCallback((): void => {
    const fit = fitAddonRef.current;
    const term = termRef.current;
    if (!fit || !term) return;
    try {
      fit.fit();
    } catch { /* RenderService 偶发未就绪，下次 ResizeObserver 兜底 */ }
    // 用户显式操作 —— 绕开 emitResize 的入口去重 / 节流 / 键盘冻结。
    // 同时声明 master=true 让此设备成为 PTY 尺寸主控，后续其他设备的非主控
    // resize 会被 backend 忽略；用户在别的设备点适配按钮才会换主控
    onResizeRef.current?.(term.cols, term.rows, true);
    lastReportedResizeRef.current = { cols: term.cols, rows: term.rows };
  }, []);

  // 注意：不传 decorations —— webgl renderer 与 SearchAddon 的 DOM decoration
  // 不兼容（位置不跟字符 + 不跟滚动）。仅靠 term.select() 显示当前匹配选区，
  // 牺牲"所有匹配同时高亮"，换来 webgl 性能 + 定位正确。
  const searchNext = useCallback((needle: string, opts?: SearchOpts): boolean => {
    const sa = searchAddonRef.current;
    if (!sa || !needle) return false;
    return sa.findNext(needle, {
      caseSensitive: opts?.caseSensitive,
      wholeWord: opts?.wholeWord,
      regex: opts?.regex,
    });
  }, []);

  const searchPrev = useCallback((needle: string, opts?: SearchOpts): boolean => {
    const sa = searchAddonRef.current;
    if (!sa || !needle) return false;
    return sa.findPrevious(needle, {
      caseSensitive: opts?.caseSensitive,
      wholeWord: opts?.wholeWord,
      regex: opts?.regex,
    });
  }, []);

  const clearSearch = useCallback((): void => {
    searchAddonRef.current?.clearDecorations();
    termRef.current?.clearSelection();
  }, []);

  const getSelection = useCallback((): string => {
    return termRef.current?.getSelection() ?? '';
  }, []);

  return {
    write,
    clear,
    reset,
    scrollToBottom,
    scrollToTop,
    setOnData,
    setAutoFollow,
    showScrollHint,
    adaptToPtySize,
    adaptToDevice,
    searchNext,
    searchPrev,
    clearSearch,
    getSelection,
    terminal: termRef,
  };
}
