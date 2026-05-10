/**
 * 轻量交互 prompt：让用户从入口候选中选一个看二维码（0.7.0）
 *
 * 兼容性优先：
 *  - 仅一行 readline question，不进 alt-screen，不抢 raw mode
 *  - 非 TTY（pipe / nohup / systemd / CI）→ 直接返回默认项，零阻塞
 *  - 超时（默认 5s）未输入 → 默认项；不会卡住启动流
 *  - 完成后立即关闭 readline，把 stdin 还给后续 TerminalRelay
 *
 * 不做：
 *  - 方向键导航（要 raw mode + ANSI escape 解析，跨终端兼容性差）
 *  - alt-screen 全屏 UI（与 PTY 子进程的 alt-screen 撕裂）
 *  - 渐进 spinner（多渲染逻辑增加 race 风险）
 */

import { createInterface, type Interface as ReadlineInterface } from 'node:readline';
import { kindLabel, type EntryCandidate } from './entry-discovery.js';

export interface PromptEntryOptions {
  candidates: EntryCandidate[];
  /**
   * 超时（ms）；> 0 时启用超时，超时返回默认项；
   * undefined / 0 / 负数 → 不设超时，无限等待用户输入（默认）。
   *
   * 默认无限等待是 0.7.0 的语义：banner 是用户挑选入口的关键交互，
   * 用户没看清就被超时跳过反而损失。非 TTY 走另一条静默退化路径，本字段
   * 仅在 TTY 模式生效。测试场景应显式传短超时避免阻塞。
   */
  timeoutMs?: number;
  /** 输入流；默认 process.stdin（测试可注入） */
  input?: NodeJS.ReadableStream;
  /** 输出流；默认 process.stderr */
  output?: NodeJS.WritableStream;
  /** 是否 TTY；默认按 input.isTTY 自动判断 */
  isTTY?: boolean;
}

export interface PromptEntryResult {
  /** 用户选中的候选 */
  selected: EntryCandidate;
  /** 选择来源：'input'（用户输入）/ 'default'（直接默认）/ 'timeout'（超时） */
  source: 'input' | 'default' | 'timeout';
}

/**
 * 提示用户选入口；非 TTY / 超时 / 直接回车 → 返回默认项
 *
 * 默认项判定：candidates 中 isDefault=true 的那个；都没标则取 [0]
 */
export async function promptEntrySelection(
  opts: PromptEntryOptions,
): Promise<PromptEntryResult> {
  const { candidates } = opts;
  if (candidates.length === 0) {
    throw new Error('promptEntrySelection: candidates 为空');
  }

  const defaultEntry = candidates.find((c) => c.isDefault) ?? candidates[0]!;
  const defaultIdx = candidates.indexOf(defaultEntry);

  const input = opts.input ?? process.stdin;
  const output = opts.output ?? process.stderr;
  const isTTY =
    opts.isTTY ?? (input as NodeJS.ReadStream).isTTY ?? false;

  // 非 TTY：直接返回默认（pipe / nohup / systemd / CI 全走这条）
  if (!isTTY) {
    return { selected: defaultEntry, source: 'default' };
  }

  // 单候选：没必要问，直接返回
  if (candidates.length === 1) {
    return { selected: defaultEntry, source: 'default' };
  }

  // 渲染列表
  output.write('\n  Pick an entry for the QR code (others remain accessible):\n\n');
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i]!;
    const num = String(i + 1).padStart(2, ' ');
    const star = c.isDefault ? ' ★' : '  ';
    const tag = `[${kindLabel(c.kind)}]`.padEnd(10, ' ');
    output.write(`   ${num}.${star} ${tag} ${c.url}\n`);
  }
  output.write('\n');

  const timeoutMs = opts.timeoutMs ?? 0;
  const useTimeout = timeoutMs > 0;
  const promptLine = useTimeout
    ? `   选择 [1-${candidates.length}，回车=${defaultIdx + 1}，${Math.round(timeoutMs / 1000)}s 超时默认]: `
    : `   选择 [1-${candidates.length}，回车=${defaultIdx + 1}]: `;

  // readline question；可选 timeoutMs > 0 时叠加超时
  const rl: ReadlineInterface = createInterface({
    input: input as NodeJS.ReadableStream,
    output,
    terminal: false, // 关闭 raw mode：不接管方向键，避免吞 PTY 输入序列
  });

  const result = await new Promise<PromptEntryResult>((resolve) => {
    let settled = false;
    let timer: NodeJS.Timeout | null = null;

    const finish = (r: PromptEntryResult): void => {
      if (settled) return;
      settled = true;
      try {
        rl.close();
      } catch {
        /* ignore */
      }
      if (timer) clearTimeout(timer);
      resolve(r);
    };

    if (useTimeout) {
      timer = setTimeout(() => {
        output.write(`\n   (timed out, using default [${defaultIdx + 1}])\n`);
        finish({ selected: defaultEntry, source: 'timeout' });
      }, timeoutMs);
      timer.unref?.();
    }

    rl.question(promptLine, (answer) => {
      const trimmed = answer.trim();
      if (trimmed === '') {
        finish({ selected: defaultEntry, source: 'default' });
        return;
      }
      const n = Number.parseInt(trimmed, 10);
      if (!Number.isInteger(n) || n < 1 || n > candidates.length) {
        output.write(`   invalid input, using default [${defaultIdx + 1}]\n`);
        finish({ selected: defaultEntry, source: 'default' });
        return;
      }
      finish({ selected: candidates[n - 1]!, source: 'input' });
    });

    // 注意：rl.close() 时如果 input 是 process.stdin，readline 默认行为会
    // 让 process.stdin 进入 paused 状态。close 后由调用方决定是否 resume
    // （TerminalRelay.start 内部会 resume，所以正常情况下不需要这里管）
  });

  return result;
}
