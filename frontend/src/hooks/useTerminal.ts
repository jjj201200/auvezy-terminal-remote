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
import '@xterm/xterm/css/xterm.css';
import {
  XTERM_WRITE_FLUSH_INTERVAL_MS,
  XTERM_WRITE_MAX_QUEUED_BYTES,
  XTERM_SCROLLBACK_LINES,
  XTERM_FONT_SIZE,
  RESIZE_THROTTLE_MS,
} from '../config/constants.js';

/**
 * onResize 回调返回值含义：
 *  - true / undefined：发送成功，更新 lastReportedResize
 *  - false：未发送（如 WS 离线），保持 lastReportedResize 不变让下次能重发
 */
export type ResizeCallback = (cols: number, rows: number) => boolean | void;

export interface UseTerminalReturn {
  /** 把数据写入 xterm（批合并） */
  write: (data: string) => void;
  /** 清屏（保留 buffer） */
  clear: () => void;
  /** 完整 reset xterm */
  reset: () => void;
  /** 滚动到底部（程序触发） */
  scrollToBottom: () => void;
  /** 设置 auto-follow 开关 */
  setAutoFollow: (enabled: boolean) => void;
  /** 是否显示"返回底部"按钮（绑定到组件 state） */
  showScrollHint: boolean;
  /** 让 xterm 与 PTY 尺寸对齐（history_sync 后调用） */
  adaptToPtySize: (cols: number, rows: number) => void;
  /** 内部 Terminal 引用（极少数高级场景使用） */
  terminal: RefObject<Terminal | null>;
}

export function useTerminal(
  containerRef: RefObject<HTMLDivElement | null>,
  onResize?: ResizeCallback,
): UseTerminalReturn {
  // ──────────────── refs ────────────────
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);

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

    const term = new Terminal({
      disableStdin: true, // 前端是只读视图，输入走独立 InputBar
      fontSize: XTERM_FONT_SIZE,
      fontFamily: "'JetBrains Mono', 'Menlo', 'Monaco', 'Courier New', monospace",
      scrollback: XTERM_SCROLLBACK_LINES,
      theme: {
        background: '#0d1117',
        foreground: '#e6edf3',
        cursor: '#e6edf3',
        selectionBackground: '#264f78',
        black: '#484f58',
        red: '#ff7b72',
        green: '#3fb950',
        yellow: '#d29922',
        blue: '#58a6ff',
        magenta: '#bc8cff',
        cyan: '#39c5cf',
        white: '#b1bac4',
        brightBlack: '#6e7681',
        brightRed: '#ffa198',
        brightGreen: '#56d364',
        brightYellow: '#e3b341',
        brightBlue: '#79c0ff',
        brightMagenta: '#d2a8ff',
        brightCyan: '#56d4dd',
        brightWhite: '#f0f6fc',
      },
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);

    // Unicode11 graceful 降级
    try {
      const u = new Unicode11Addon();
      term.loadAddon(u);
      term.unicode.activeVersion = '11';
    } catch {
      /* fallback to default unicode width */
    }

    term.open(container);

    // WebGL graceful 降级到 canvas
    try {
      const webgl = new WebglAddon();
      webgl.onContextLoss(() => webgl.dispose());
      term.loadAddon(webgl);
    } catch {
      /* canvas renderer 是默认 fallback */
    }

    fitAddon.fit();
    // 等布局稳定后做首次 resize 上报
    requestAnimationFrame(() => {
      if (termRef.current) emitResize(term.cols, term.rows);
    });

    termRef.current = term;
    fitAddonRef.current = fitAddon;

    // 容器尺寸变化 → fit + 上报
    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit();
      emitResize(term.cols, term.rows);
    });
    resizeObserver.observe(container);

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
      resizeObserver.disconnect();
      onScrollDispose.dispose();

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
    };
  }, [containerRef, emitResize, flushWriteQueue]);

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

  const setAutoFollow = useCallback((enabled: boolean) => {
    autoFollowRef.current = enabled;
    if (enabled) setShowScrollHint(false);
  }, []);

  const adaptToPtySize = useCallback((_cols: number, _rows: number): void => {
    const fit = fitAddonRef.current;
    const term = termRef.current;
    if (!fit || !term) return;
    fit.fit();
    // 主动上报当前 xterm 实际尺寸——这才是 PTY 应该跟随的尺寸
    emitResize(term.cols, term.rows);
  }, [emitResize]);

  return {
    write,
    clear,
    reset,
    scrollToBottom,
    setAutoFollow,
    showScrollHint,
    adaptToPtySize,
    terminal: termRef,
  };
}
