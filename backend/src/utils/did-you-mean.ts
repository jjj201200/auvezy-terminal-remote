/**
 * 拼写建议 helper —— didyoumean2 的薄包装
 *
 * 用途:
 *  - 未知 subcommand:`atr stp` → 建议 `stop`
 *  - 未知 flag:`atr --por 3000` → 建议 `--port`
 *  - command not found:`atr cluade` → 建议 PATH 上的 `claude`
 *
 * 设计:
 *  - 命中 0 个 → 返回 null,调用方自决"无建议"文案
 *  - 命中 1 个 → 返回字符串,调用方拼成 "did you mean: X?"
 *  - 故意只取 top1:多个建议反而让用户犹豫;只给一个最像的最直接
 *  - threshold 略松(0.5),拼写错误通常打 1~2 个字母,默认 0.4 太严会漏
 */

import didYouMean, { ReturnTypeEnums, ThresholdTypeEnums } from 'didyoumean2';

export interface SuggestOptions {
  /** 备选词列表 */
  candidates: readonly string[];
  /**
   * 相似度阈值(0~1,越大越严)。默认 0.5,适合短词命令名。
   * 同名 distance:1 - levenshtein/maxLen
   */
  threshold?: number;
}

/**
 * 给 input 找最相似的备选词。
 *
 * @returns 命中 → 字符串;无命中或 input 已是备选 → null
 */
export function suggest(input: string, opts: SuggestOptions): string | null {
  if (!input) return null;
  // 已是合法值则没必要"建议"
  if (opts.candidates.includes(input)) return null;
  const result = didYouMean(input, opts.candidates as string[], {
    returnType: ReturnTypeEnums.FIRST_CLOSEST_MATCH,
    thresholdType: ThresholdTypeEnums.SIMILARITY,
    threshold: opts.threshold ?? 0.5,
  });
  return typeof result === 'string' ? result : null;
}
