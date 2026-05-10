/**
 * entry-prompt 单测
 *
 * - 非 TTY → 立即返回默认（不阻塞）
 * - 单候选 → 立即返回（不阻塞）
 * - 用户输入合法数字 → 选中对应项
 * - 直接回车 → 默认
 * - 输入越界 → 退化默认
 * - 超时未输入 → 默认
 *
 * 用 PassThrough 流模拟 stdin/stdout；isTTY 通过 opts.isTTY 注入
 */

import { describe, it, expect } from 'vitest';
import { PassThrough } from 'node:stream';
import { promptEntrySelection } from './entry-prompt.js';
import type { EntryCandidate } from './entry-discovery.js';

function mkCandidates(): EntryCandidate[] {
  return [
    {
      url: 'http://192.168.1.4:3000/i/abc/',
      host: '192.168.1.4',
      port: 3000,
      kind: 'lan',
      isDefault: true,
    },
    {
      url: 'http://100.64.0.1:3000/i/abc/',
      host: '100.64.0.1',
      port: 3000,
      kind: 'tailscale',
    },
    {
      url: 'http://127.0.0.1:3000/i/abc/',
      host: '127.0.0.1',
      port: 3000,
      kind: 'loopback',
    },
  ];
}

describe('promptEntrySelection', () => {
  it('非 TTY → 立即返回默认（不阻塞）', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    output.resume();
    const r = await promptEntrySelection({
      candidates: mkCandidates(),
      input,
      output,
      isTTY: false,
    });
    expect(r.source).toBe('default');
    expect(r.selected.host).toBe('192.168.1.4');
  });

  it('单候选 → 立即返回（不阻塞）', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    output.resume();
    const r = await promptEntrySelection({
      candidates: [mkCandidates()[0]!],
      input,
      output,
      isTTY: true,
    });
    expect(r.source).toBe('default');
  });

  it('用户输入 "2" → 选 Tailscale', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    output.resume();
    const promise = promptEntrySelection({
      candidates: mkCandidates(),
      input,
      output,
      isTTY: true,
      timeoutMs: 1000,
    });
    // 先让 readline 把 question 渲染出来再喂输入
    setImmediate(() => input.write('2\n'));
    const r = await promise;
    expect(r.source).toBe('input');
    expect(r.selected.kind).toBe('tailscale');
  });

  it('用户直接回车 → 默认', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    output.resume();
    const promise = promptEntrySelection({
      candidates: mkCandidates(),
      input,
      output,
      isTTY: true,
      timeoutMs: 1000,
    });
    setImmediate(() => input.write('\n'));
    const r = await promise;
    expect(r.source).toBe('default');
    expect(r.selected.host).toBe('192.168.1.4');
  });

  it('输入越界 "99" → 退化默认', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    output.resume();
    const promise = promptEntrySelection({
      candidates: mkCandidates(),
      input,
      output,
      isTTY: true,
      timeoutMs: 1000,
    });
    setImmediate(() => input.write('99\n'));
    const r = await promise;
    expect(r.source).toBe('default');
  });

  it('输入非数字 "xyz" → 退化默认', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    output.resume();
    const promise = promptEntrySelection({
      candidates: mkCandidates(),
      input,
      output,
      isTTY: true,
      timeoutMs: 1000,
    });
    setImmediate(() => input.write('xyz\n'));
    const r = await promise;
    expect(r.source).toBe('default');
  });

  it('超时未输入 → 默认（source=timeout）', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    output.resume();
    const r = await promptEntrySelection({
      candidates: mkCandidates(),
      input,
      output,
      isTTY: true,
      timeoutMs: 50, // 短超时让测试快
    });
    expect(r.source).toBe('timeout');
    expect(r.selected.host).toBe('192.168.1.4');
  });

  it('candidates 为空 → 抛错（防御）', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    output.resume();
    await expect(
      promptEntrySelection({
        candidates: [],
        input,
        output,
        isTTY: false,
      }),
    ).rejects.toThrow(/candidates 为空/);
  });
});
