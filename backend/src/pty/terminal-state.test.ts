/**
 * TerminalState 单测（替代旧 output-buffer.test.ts）
 *
 * 覆盖 grid 状态模型的核心行为契约（ADR-001/002）：
 *  - serialize → 新终端恢复的闭环（回放保真度）
 *  - TUI 重绘帧去重（旧 OutputBuffer.partial 无界问题的根除验证）
 *  - CSI 3J strip（ink 的清 scrollback 序列不生效）
 *  - 超长"单行"wrap 封顶（行长无界维度消失）
 *  - resize 同步 / seq 版本戳 / strip 纯函数
 */

import { describe, it, expect } from 'vitest';
import xtermHeadless from '@xterm/headless';
import { TerminalState, stripEraseScrollback } from './terminal-state.js';

const { Terminal } = xtermHeadless as typeof import('@xterm/headless');

/** 等 headless 解析队列 flush（与 TerminalState.serialize 同款技巧） */
const flush = (term: InstanceType<typeof Terminal>): Promise<void> =>
  new Promise((resolve) => term.write('', resolve));

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** 新建一个反向验证终端，write serialize 输出后返回非空行文本 */
async function restoreLines(
  data: string,
  opts: { cols: number; rows: number; scrollback: number },
): Promise<string[]> {
  const dst = new Terminal({ ...opts, allowProposedApi: true });
  dst.write(data);
  await flush(dst);
  const lines: string[] = [];
  for (let y = 0; y < dst.buffer.active.length; y++) {
    const s = dst.buffer.active.getLine(y)?.translateToString(true) ?? '';
    if (s.trim().length > 0) lines.push(s.trim());
  }
  dst.dispose();
  return lines;
}

function makeState(scrollback = 100): TerminalState {
  return new TerminalState({ scrollback, cols: 80, rows: 24 });
}

describe('TerminalState（grid 状态模型）', () => {
  it('行式输出 serialize 后可在新终端恢复（闭环）', async () => {
    const state = makeState();
    state.write('line-one\r\nline-two\r\nline-three');
    const out = await state.serialize();
    const lines = await restoreLines(out, { cols: 80, rows: 24, scrollback: 100 });
    expect(lines).toEqual(['line-one', 'line-two', 'line-three']);
    state.dispose();
  });

  it('TUI 重绘帧去重：serialize 只含最终帧', async () => {
    const state = makeState();
    for (let i = 0; i < 1000; i++) {
      state.write(`\x1b[H\x1b[2Jframe-${i}\r\nsecond ${i}`);
    }
    const out = await state.serialize();
    expect(out).toContain('frame-999');
    expect(out).not.toContain('frame-500');
    state.dispose();
  });

  it('CSI 3J 被 strip：scrollback 不被 ink 清屏序列擦掉', async () => {
    const state = makeState();
    for (let i = 0; i < 50; i++) state.write(`history-${i}\r\n`);
    state.write('\x1b[3J');
    await sleep(10);
    const out = await state.serialize();
    expect(out).toContain('history-0');
    expect(out).toContain('history-49');
    state.dispose();
  });

  it('超长单行 wrap 封顶：buffer 行数不超过 scrollback + rows', async () => {
    const state = makeState(100);
    // 500 行当量的无 \n 输出——旧 OutputBuffer 会全部堆在 partial
    state.write('x'.repeat(80 * 500));
    await sleep(10);
    expect(state.lineCount).toBeLessThanOrEqual(100 + 24);
    state.dispose();
  });

  it('TUI 重绘 + 3J 洪流下内存语义有界（事故负载回归）', async () => {
    const state = makeState(1000);
    const spinner = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏';
    for (let i = 0; i < 20000; i++) {
      state.write(
        `\x1b[3J\x1b[H\x1b[2J Task ${i}\r\n${spinner[i % 10]} working...\r\ncontent ${i}`,
      );
    }
    const out = await state.serialize();
    // 只剩最终画面，几十 KB 量级以内
    expect(out.length).toBeLessThan(64 * 1024);
    expect(state.lineCount).toBeLessThanOrEqual(1000 + 24);
    state.dispose();
  });

  it('resize 同步 grid（同尺寸跳过）', async () => {
    const state = makeState();
    state.write('a'.repeat(40) + 'b'.repeat(40) + '\r\nnext');
    await sleep(10);
    state.resize(20, 24);
    await sleep(10);
    // 80 字符行在 20 列下 wrap 成 4 行
    const out = await state.serialize();
    const lines = await restoreLines(out, { cols: 20, rows: 24, scrollback: 100 });
    expect(lines.some((l) => l.startsWith('aaaa'))).toBe(true);
    state.dispose();
  });

  it('seq 是 write 计数（版本戳），clear 不重置', () => {
    const state = makeState();
    expect(state.sequenceNumber).toBe(0);
    state.write('a');
    state.write('b');
    state.write('');
    expect(state.sequenceNumber).toBe(3);
    state.clear();
    expect(state.sequenceNumber).toBe(3);
    state.dispose();
  });

  it('serialize 在 write 之后能拿到完整状态（flush 契约）', async () => {
    const state = makeState();
    state.write('flushed-content');
    const out = await state.serialize();
    expect(out).toContain('flushed-content');
    state.dispose();
  });

  it('alt-screen 内的当前画面可被 serialize 恢复', async () => {
    const state = makeState();
    state.write('normal-history\r\n');
    state.write('\x1b[?1049h'); // 进 alt（不退出——重连发生在 alt 内）
    state.write('\x1b[H\x1b[2JALT-FINAL-FRAME');
    const out = await state.serialize();
    expect(out).toContain('ALT-FINAL-FRAME');
    expect(state.inAltScreen).toBe(true);
    state.dispose();
  });
});

describe('stripEraseScrollback（纯函数）', () => {
  it('剥掉 CSI 3J', () => {
    expect(stripEraseScrollback('before\x1b[3Jafter')).toBe('beforeafter');
    expect(stripEraseScrollback('\x1b[3J\x1b[3J')).toBe('');
  });

  it('不影响其它 CSI J 形态（0J/2J 是正常清屏，不能误删）', () => {
    expect(stripEraseScrollback('\x1b[0J')).toBe('\x1b[0J');
    expect(stripEraseScrollback('\x1b[2J')).toBe('\x1b[2J');
    expect(stripEraseScrollback('\x1b[J')).toBe('\x1b[J');
    // CSI ?3 J（DECRST 3，带问号）与 CSI 3 J 不同，不删
    expect(stripEraseScrollback('\x1b[?3J')).toBe('\x1b[?3J');
  });

  it('无 ESC 的纯文本走快速路径原样返回', () => {
    expect(stripEraseScrollback('plain text\r\n')).toBe('plain text\r\n');
  });
});
