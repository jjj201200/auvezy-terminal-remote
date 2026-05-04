/**
 * OutputBuffer
 *
 * 按行环形缓冲，存储 PTY 原始 ANSI 输出，用于客户端重连时全量回放。
 *
 * 关键语义：
 * - 按行存储（lines: string[]），便于"最大行数"上限语义直观
 * - 不完整行（无尾部 \n）暂存到 partial，下次 append 时拼接
 * - seq 单调递增，每次 append 调用 +1（不论数据多少）——仅作版本戳，不支持差量
 * - 超过 maxLines × 1.1 才裁剪，把 splice 成本均摊
 * - getFullContent 重建带 \n 的原始流，让重连后看到的内容与实时一致
 *
 * 复杂度：
 * - append: O(append 行数)，trim 摊销 O(maxLines × 0.1)
 * - getFullContent: O(总字符数) — 重连时一次性调用，不在热路径
 */

export class OutputBuffer {
  private lines: string[] = [];
  /** 最后一段不完整的行（未碰到 \n 时累积） */
  private partial = '';
  /** 单调递增版本号 */
  private seq = 0;
  /** 行数上限（超过 maxLines × 1.1 时裁剪） */
  private readonly maxLines: number;

  /**
   * @param maxLines 缓冲区最大行数（默认 10000）
   */
  constructor(maxLines = 10_000) {
    if (!Number.isInteger(maxLines) || maxLines <= 0) {
      throw new Error('OutputBuffer: maxLines 必须是正整数');
    }
    this.maxLines = maxLines;
  }

  /** 当前版本号 */
  get sequenceNumber(): number {
    return this.seq;
  }

  /** 当前缓冲行数（不含 partial） */
  get lineCount(): number {
    return this.lines.length;
  }

  /**
   * 追加 PTY 输出片段
   *
   * 输入可能：
   * - 不含 \n（全部并入 partial）
   * - 含一个或多个 \n（分割后前面入 lines，最后片段入 partial）
   * - 以 \n 结尾（最后片段为空，partial 重置为空字符串）
   */
  append(data: string): void {
    this.seq++;

    if (data.length === 0) return;

    const combined = this.partial + data;
    const parts = combined.split('\n');

    // split('\n') 后最后一个元素是 \n 之后的部分（可能为空字符串）
    // 它就是新的 partial；前面所有元素都是完整行
    this.partial = parts.pop() ?? '';

    if (parts.length > 0) {
      // 直接 push 完整行
      for (const line of parts) {
        this.lines.push(line);
      }
    }

    // 摊销裁剪：超过 maxLines × 1.1 才一次性裁到 maxLines
    const trimThreshold = Math.floor(this.maxLines * 1.1);
    if (this.lines.length > trimThreshold) {
      this.lines = this.lines.slice(this.lines.length - this.maxLines);
    }
  }

  /**
   * 获取重建后的完整缓冲内容（含已落定的行 + 尾部 partial）
   *
   * 输出形式：
   * - 无内容时返回 ''
   * - 仅 partial 时返回 partial（无尾随 \n）
   * - 仅完整行时每行后跟 \n（保留原始流结构）
   * - 既有完整行又有 partial 时：行间 \n + 尾部 partial（无尾随 \n）
   *
   * 设计目的：让客户端 xterm.js 接收 history_sync.data 后，
   * 直接 term.write(data) 即可还原与实时一致的画面
   */
  getFullContent(): string {
    if (this.lines.length === 0) {
      return this.partial;
    }
    // 完整行之间用 \n 分隔，且最后一行后也补 \n（因为它原本就是带 \n 落定的）
    const joined = this.lines.join('\n') + '\n';
    return this.partial.length > 0 ? joined + this.partial : joined;
  }

  /** 清空所有内容（保留 seq——seq 是版本戳不重置） */
  clear(): void {
    this.lines = [];
    this.partial = '';
  }
}
