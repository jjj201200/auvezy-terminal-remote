/**
 * TerminalRelay
 *
 * 把 PC 终端（process.stdin/stdout）与 PTY 进程做 raw mode 透传，
 * 让代理层启动后用户在 PC 上的体验等同直接跑 claude。
 *
 * 责任：
 * - 启动时把 stdin 设 raw mode + resume，所有按键直通 PTY
 * - 监听 SIGWINCH（终端尺寸变化）→ 同步给 PTY（除非被 pauseResize）
 * - 双 Ctrl+C 检测：500ms 内两次 Ctrl+C 视为"退代理"信号，调用 onExitRequest 回调
 *   单次 Ctrl+C 透传给 PTY（让 Claude 自行处理：通常是取消当前任务）
 * - 兼容 Kitty 键盘协议的 CSI u 形式：\x1b[99;5u 等价于 Ctrl+C
 *
 * 主从仲裁配合：
 * - pauseResize：webapp 或 attach 客户端连入时调用，让 PC 不再驱动尺寸
 * - resumeResize：所有客户端断开时调用，PC 重新接管
 *
 * stop() 时务必恢复 stdin 原始状态——否则用户终端会"卡在 raw mode"
 */

import type { IPtyManager } from '../pty/types.js';
import { logger } from '../logger/logger.js';
import { DOUBLE_CTRL_C_WINDOW_MS } from '../constants.js';

/** 字节级常量 */
const CTRL_C_BYTE = 0x03; // \x03 = ETX = Ctrl+C

/**
 * 终端模式复位序列
 *
 * 退出代理前向 process.stdout 写一次，把 PTY 子进程留下的副作用全清干净。
 * 顺序无关；浏览器 TUI（claude/vim/htop/fzf 等）启用了什么我们都关一遍。
 *
 * 各序列含义（DEC private mode reset，?...l = reset，?...h = set）：
 *   ?1l         应用键盘模式 → 关（方向键回到 ESC[A 标准）
 *   ?9l         X10 鼠标 → 关
 *   ?1000l      X11 鼠标 (按下/释放) → 关
 *   ?1001l      鼠标 highlight tracking → 关
 *   ?1002l      鼠标按下时移动 → 关  ← claude/vim 常开
 *   ?1003l      所有鼠标移动 → 关
 *   ?1004l      焦点变化报告 → 关
 *   ?1005l      鼠标 UTF-8 模式 → 关
 *   ?1006l      鼠标 SGR 模式 → 关  ← 用户看到的乱码就是这个
 *   ?1015l      鼠标 urxvt 模式 → 关
 *   ?2004l      bracketed paste → 关
 *   ?1049l      退出 alt-screen 回到主屏  ← 不还原会"看似无响应"
 *   ?25h        显示光标（很多 TUI 退出忘了打开）
 *   ESC[m       SGR reset：清掉残留颜色 / 加粗 / 反相
 */
const TERM_RESET_SEQ =
  '\x1b[?1l' +
  '\x1b[?9l' +
  '\x1b[?1000l' +
  '\x1b[?1001l' +
  '\x1b[?1002l' +
  '\x1b[?1003l' +
  '\x1b[?1004l' +
  '\x1b[?1005l' +
  '\x1b[?1006l' +
  '\x1b[?1015l' +
  '\x1b[?2004l' +
  '\x1b[?1049l' +
  '\x1b[?25h' +
  '\x1b[m';

/**
 * Kitty 键盘协议 CSI u 形式的 Ctrl+C：
 *   基础：\x1b[99;5u
 *   带事件类型：\x1b[99;5:1u（press）/ \x1b[99;5:2u（repeat）；3 是 release 不算
 *   带文本占位：\x1b[99;5;XXXu
 *
 * 99 = 'c' 的 unicode 代码点，5 = Ctrl 修饰位。
 *
 * 仅匹配 press / repeat（事件类型 1 或 2 或省略），不匹配 release（3）。
 */
const KITTY_CTRL_C_RE = /\x1b\[99;5(?::(?:[12]))?(?:;\d+)*u/;

export interface TerminalRelayOptions {
  /**
   * 双 Ctrl+C 触发的回调（用户希望停代理）
   *
   * 默认未设置时退化为：第二次 Ctrl+C 仍透传给 PTY（也就是不启用退代理逻辑）
   */
  onExitRequest?: () => void;
}

export class TerminalRelay {
  private stdinHandler: ((chunk: Buffer) => void) | null = null;
  private resizeHandler: (() => void) | null = null;
  private wasRaw = false;
  private resizePaused = false;
  private lastCtrlCAt = 0;
  private started = false;

  constructor(
    private readonly pty: IPtyManager,
    private readonly opts: TerminalRelayOptions = {},
  ) {}

  /**
   * 启动 raw mode 透传
   *
   * 非 TTY 环境（pnpm dev 通过管道、CI 等）下也能调用：
   * - 不会调用 setRawMode（不存在）
   * - 仅监听 stdin 'data' 事件做 Ctrl+C 检测和透传
   */
  start(): void {
    if (this.started) return;
    this.started = true;

    if (process.stdin.isTTY && typeof process.stdin.setRawMode === 'function') {
      this.wasRaw = process.stdin.isRaw === true;
      process.stdin.setRawMode(true);
      logger.debug('stdin 进入 raw mode');
    } else {
      logger.warn('stdin 不是 TTY，TerminalRelay 跳过 setRawMode');
    }

    process.stdin.resume();
    process.stdin.setEncoding('utf8');

    this.stdinHandler = (chunk: Buffer) => this.handleStdin(chunk);
    process.stdin.on('data', this.stdinHandler);

    if (process.stdout.isTTY) {
      this.resizeHandler = () => this.handleResize();
      process.stdout.on('resize', this.resizeHandler);
      // 启动时主动同步一次（让 PTY 与 PC 终端尺寸对齐）
      this.handleResize();
    }
  }

  /**
   * 停止透传，恢复 stdin + 复位本地终端模式
   *
   * 为什么需要复位本地终端模式：
   *   PTY 子进程（claude / vim / htop / fzf 等）通过 escape 序列改了**本地终端**的
   *   状态——开启鼠标追踪、切到 alt-screen、应用键盘模式、bracketed paste、隐藏光标。
   *   这些状态写在 termios / 终端 emulator 里，PTY 退出时**不会自动还原**。
   *   不复位的后果（用户实测）：atr 退出后本地终端
   *     - 鼠标移动 / 点击被解析成坐标字符串疯狂 echo
   *     - 终端"看似无响应"（实则在 alt-screen 里）
   *     - 方向键发的序列错位
   *
   * 幂等
   */
  stop(): void {
    if (!this.started) return;
    this.started = false;

    if (this.stdinHandler) {
      process.stdin.off('data', this.stdinHandler);
      this.stdinHandler = null;
    }
    if (this.resizeHandler) {
      process.stdout.off('resize', this.resizeHandler);
      this.resizeHandler = null;
    }

    // 复位本地终端模式（仅 TTY 才有意义）
    if (process.stdout.isTTY) {
      // 一次性发完所有 reset，避免分多次写入引入闪烁
      process.stdout.write(TERM_RESET_SEQ);
    }

    if (process.stdin.isTTY && typeof process.stdin.setRawMode === 'function') {
      process.stdin.setRawMode(this.wasRaw);
      logger.debug({ wasRaw: this.wasRaw }, 'stdin 恢复');
    }

    // 不调 pause——因为 cli 主进程可能仍需要监听 stdin（如非 TTY 模式下的 Ctrl+C）
  }

  /** 暂停 PC 端 resize 同步——客户端连入时调用 */
  pauseResize(): void {
    if (!this.resizePaused) {
      this.resizePaused = true;
      logger.debug('PC 端 resize 暂停（远程客户端接管）');
    }
  }

  /** 恢复 PC 端 resize 同步——所有客户端断开时调用 */
  resumeResize(): void {
    if (this.resizePaused) {
      this.resizePaused = false;
      logger.debug('PC 端 resize 恢复');
      // 立即同步一次当前 PC 终端尺寸
      this.handleResize();
    }
  }

  // ──────────────── 内部 ────────────────

  /**
   * 处理 stdin 输入
   *
   * 判定流程：
   * 1. 是单字节 \x03 或匹配 Kitty CSI u Ctrl+C 序列 → 进入双击检测
   *    - 双击窗口内：触发 onExitRequest（如果设置），不再写 PTY
   *    - 第一次：透传 + 记时间戳
   * 2. 其它：直接透传
   */
  private handleStdin(chunk: Buffer | string): void {
    // setEncoding('utf8') 后实际是 string，但保留 Buffer 处理路径以防万一
    const str = typeof chunk === 'string' ? chunk : chunk.toString('utf8');

    if (this.isCtrlC(str)) {
      const now = Date.now();
      if (this.lastCtrlCAt > 0 && now - this.lastCtrlCAt <= DOUBLE_CTRL_C_WINDOW_MS) {
        // 双 Ctrl+C
        this.lastCtrlCAt = 0;
        if (this.opts.onExitRequest) {
          logger.info('检测到双 Ctrl+C，请求退出代理');
          this.opts.onExitRequest();
          return;
        }
        // 没有 onExitRequest 时也透传第二次（让 Claude 自己处理）
      }
      this.lastCtrlCAt = now;
      this.pty.write(str);
      return;
    }

    // 非 Ctrl+C 直接透传
    this.pty.write(str);
  }

  private isCtrlC(s: string): boolean {
    // 单字节 ETX
    if (s.length === 1 && s.charCodeAt(0) === CTRL_C_BYTE) return true;
    // Kitty 协议 CSI u 形式
    return KITTY_CTRL_C_RE.test(s);
  }

  private handleResize(): void {
    if (this.resizePaused) return;
    const cols = process.stdout.columns;
    const rows = process.stdout.rows;
    if (typeof cols === 'number' && typeof rows === 'number') {
      this.pty.resize(cols, rows);
    }
  }
}
