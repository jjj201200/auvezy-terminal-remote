/**
 * TerminalState
 *
 * grid 状态模型的重连回放缓冲（headless-terminal-buffer 计划，替代 OutputBuffer）。
 *
 * 设计（ADR-001）：
 * - 用 @xterm/headless 的 Terminal 作为状态容器：PTY 输出经完整 VT 解析器写入
 *   normal buffer grid + alt buffer，而非按 \n 分行的原始字节流
 * - 内存/CPU 语义有界：上限来自 scrollback 行数 × 列宽（万行量级 ≈ 几 MB），
 *   不需要外加字节硬上限——TUI 重绘是覆盖写，旧帧在 grid 中自动消失；
 *   超长"单行"输出自动 wrap 成多行挤进 scrollback（旧 OutputBuffer 的 partial
 *   无界 + O(n²) 拼接问题在此模型下不存在）
 * - 重连回放：SerializeAddon 把 buffer + 光标序列化成转义流，写入新终端即恢复
 *   （VS Code 终端持久化的同款架构）
 *
 * CSI 3J strip（ADR-002）：
 * - claude/ink 每次重绘前发 \x1b[3J（Erase Saved Lines）清 scrollback——必须在
 *   写入前剥掉，否则 headless 自己的 scrollback 被清空、重连丢历史
 * - 跨 chunk 切断的 4 字节序列概率极低（与旧 AnsiFilter 同款论证），接受
 *
 * 写入与序列化的时序契约：
 * - term.write 排队异步解析（Node 下按 setImmediate 分片），write 返回时数据
 *   未必已进 grid
 * - serialize() 内部先写一个空 chunk 等待队列 flush（其 callback 在全部已排队
 *   数据解析完后触发），再执行序列化——调用方拿到的是完整状态
 * - sequenceNumber 是同步递增的 write 计数：调用方在 await serialize() 前后
 *   比对它即可检测"序列化期间是否有新写入"（恢复点是同步延续，比对+消费原子）
 */

import xtermHeadless from '@xterm/headless';
import xtermSerialize from '@xterm/addon-serialize';

// UMD 打包产物无法被 cjs-module-lexer 识别出 named export，只能 default +
// 解构（spike 实测）；类型仍走包自带 d.ts
const { Terminal } = xtermHeadless as typeof import('@xterm/headless');
const { SerializeAddon } = xtermSerialize as typeof import('@xterm/addon-serialize');

/** Erase Saved Lines（CSI 3 J）：ink 类 TUI 用来擦 scrollback，必须剥掉 */
const ERASE_SCROLLBACK_RE = /\x1b\[3J/g;

/**
 * 剥 CSI 3J（Erase Saved Lines）
 *
 * 广播流（terminal_output）与写入流（TerminalState.write）共用——前端 xterm 的
 * scrollback 与 headless 的 scrollback 都不能被 ink 的清屏序列擦掉。
 * TerminalState.write 内部还会防御性再 strip 一次（幂等，无匹配时代价极低）。
 */
export function stripEraseScrollback(data: string): string {
  if (!data.includes('\x1b')) return data; // 快速路径：纯文本 chunk 直接返回
  return data.replace(ERASE_SCROLLBACK_RE, '');
}

/** serialize() flush 循环的最大重试次数（高频输出下 seq 一直变时的兜底） */
export const SERIALIZE_MAX_ATTEMPTS = 3;

export interface TerminalStateOptions {
  /** scrollback 行数上限（对应旧 OutputBuffer 的 maxBufferLines 语义） */
  scrollback: number;
  /** 初始列数 */
  cols: number;
  /** 初始行数 */
  rows: number;
}

export class TerminalState {
  private readonly term: InstanceType<typeof Terminal>;
  private readonly serializeAddon: InstanceType<typeof SerializeAddon>;
  /** 单调递增 write 计数——版本戳，与旧 OutputBuffer.seq 同语义 */
  private seq = 0;

  constructor(opts: TerminalStateOptions) {
    // allowProposedApi: serialize addon 访问 term.buffer（proposed API）的前提
    this.term = new Terminal({
      scrollback: opts.scrollback,
      cols: opts.cols,
      rows: opts.rows,
      allowProposedApi: true,
    });
    this.serializeAddon = new SerializeAddon();
    this.term.loadAddon(this.serializeAddon);
  }

  /** 当前版本号（每次 write +1） */
  get sequenceNumber(): number {
    return this.seq;
  }

  /**
   * 当前 buffer 总行数（scrollback + viewport）
   *
   * 与旧 OutputBuffer.lineCount 语义近似（旧值不含 partial），仅用于日志/诊断
   */
  get lineCount(): number {
    return this.term.buffer.active.length;
  }

  /** 当前是否处于 alt-screen（重连回放时前端需要该状态决定滚动行为） */
  get inAltScreen(): boolean {
    return this.term.buffer.active.type === 'alternate';
  }

  /**
   * 写入一段 PTY 输出
   *
   * 剥 CSI 3J 后交给 headless 解析。同步返回——数据进入解析队列，实际写入 grid
   * 是异步的（需要完整状态时用 {@link serialize}，它内部会等队列 flush）。
   */
  write(data: string): void {
    this.seq++;
    if (data.length === 0) return;
    const stripped = data.replace(ERASE_SCROLLBACK_RE, '');
    this.term.write(stripped);
  }

  /**
   * 序列化当前终端状态（当前画面 + scrollback）为转义流
   *
   * 内部先 flush 解析队列再序列化，返回值写入一个全新终端即可恢复画面。
   * 高频输出下序列化期间可能有新写入到达——调用方应在 await 前后比对
   * sequenceNumber 决定是否重试（见 SessionController.sendHistorySync）。
   *
   * @returns 可被 term.write 消费的转义序列流
   */
  async serialize(): Promise<string> {
    // 空 chunk 的 callback 在全部已排队数据解析完后触发
    await new Promise<void>((resolve) => this.term.write('', resolve));
    return this.serializeAddon.serialize();
  }

  /**
   * 同步尺寸调整（grid 的 wrap 重排由 xterm 内建 reflow 处理，与 tmux 一致）
   */
  resize(cols: number, rows: number): void {
    if (cols === this.term.cols && rows === this.term.rows) return;
    this.term.resize(cols, rows);
  }

  /** 清空全部状态（保留 seq——seq 是版本戳不重置，与旧 OutputBuffer.clear 一致） */
  clear(): void {
    this.term.reset();
  }

  /** 释放底层资源（worker shutdown 用） */
  dispose(): void {
    this.term.dispose();
  }
}
