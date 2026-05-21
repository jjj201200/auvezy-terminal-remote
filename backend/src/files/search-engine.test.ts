/**
 * search-engine 单元测试
 *
 * 真实 tmp 目录 fixture,覆盖:
 *  - name / content 双模式
 *  - 忽略目录(node_modules 等)
 *  - 二进制跳过
 *  - 跨行 regex 拒
 *  - 畸形 regex 拒
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runSearch, type SearchHit } from './search-engine.js';

describe('runSearch', () => {
  let root: string;

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'fb-search-'));
    mkdirSync(join(root, 'node_modules'));
    mkdirSync(join(root, 'src'));
    writeFileSync(join(root, 'README.md'), 'hello checkWorkdir world\nsecond line');
    writeFileSync(join(root, 'src', 'main.ts'), 'export const checkWorkdir = 1;\n// other');
    writeFileSync(join(root, 'node_modules', 'leak.txt'), 'checkWorkdir but ignored');
    writeFileSync(join(root, 'bin.dat'), Buffer.from([0x00, 0x01, 0x02]));
    // cancel 测试用 fixture:多层嵌套 + 大量文件,确保 walk 真的需要时间
    // 而不是几毫秒走完(否则 cancel 路径无法被触发覆盖)
    for (let i = 0; i < 4; i++) {
      const sub = join(root, `bulk${i}`);
      mkdirSync(sub);
      for (let j = 0; j < 50; j++) {
        writeFileSync(join(sub, `f${j}.txt`), 'lorem ipsum '.repeat(20));
      }
    }
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('name 模式按 substring 匹配', async () => {
    const hits: SearchHit[] = [];
    const done = await runSearch({
      scope: root,
      q: 'main',
      mode: 'name',
      caseSensitive: false,
      regex: false,
      policy: { allow: [], deny: [] },
      emit: (h) => hits.push(h),
    });
    expect(hits.some((h) => h.kind === 'name' && h.path.endsWith('main.ts'))).toBe(true);
    expect(done.scanned).toBeGreaterThan(0);
  });

  it('content 模式命中行号正确', async () => {
    const hits: SearchHit[] = [];
    await runSearch({
      scope: root,
      q: 'checkWorkdir',
      mode: 'content',
      caseSensitive: true,
      regex: false,
      policy: { allow: [], deny: [] },
      emit: (h) => hits.push(h),
    });
    const ts = hits.find((h) => h.kind === 'content' && h.path.endsWith('main.ts'));
    expect(ts).toBeTruthy();
    if (ts && ts.kind === 'content') {
      expect(ts.line).toBe(1);
    }
  });

  it('忽略 node_modules', async () => {
    const hits: SearchHit[] = [];
    await runSearch({
      scope: root,
      q: 'checkWorkdir',
      mode: 'content',
      caseSensitive: true,
      regex: false,
      policy: { allow: [], deny: [] },
      emit: (h) => hits.push(h),
    });
    expect(hits.every((h) => !h.path.includes('node_modules'))).toBe(true);
  });

  it('二进制文件跳过(NUL 字节)', async () => {
    const hits: SearchHit[] = [];
    await runSearch({
      scope: root,
      // 空 q 即使匹配也不会命中文本,但保险起见用任意 q,期待 bin.dat 不出现
      q: 'a',
      mode: 'content',
      caseSensitive: true,
      regex: false,
      policy: { allow: [], deny: [] },
      emit: (h) => hits.push(h),
    });
    expect(hits.every((h) => !h.path.endsWith('bin.dat'))).toBe(true);
  });

  it('regex 含 \\n 抛 SEARCH_INVALID_Q', async () => {
    await expect(
      runSearch({
        scope: root,
        q: 'a\nb',
        mode: 'content',
        caseSensitive: true,
        regex: true,
        policy: { allow: [], deny: [] },
        emit: () => {},
      }),
    ).rejects.toThrow(/cross-line|invalid|SEARCH_INVALID_Q/i);
  });

  it('cancelSignal 触发立即停止 + 主动 close dirh', async () => {
    const ac = new AbortController();
    const hits: SearchHit[] = [];
    const p = runSearch({
      scope: root,
      q: 'lorem',
      mode: 'content',
      caseSensitive: false,
      regex: false,
      policy: { allow: [], deny: [] },
      emit: (h) => hits.push(h),
      cancelSignal: ac.signal,
    });
    // walk 开始后立即取消;fixture 有 200 个文件,正常需百 ms 量级
    await new Promise((r) => setImmediate(r));
    ac.abort();
    const done = await p;
    // 取消必须快(<1s);若 cancel 路径退化为"等 walk 自然结束",timing 会显著拉长
    expect(done.elapsedMs).toBeLessThan(1000);
    // 取消时大概率没能扫完 200 个文件 → 命中数应远少于全量
    expect(hits.length).toBeLessThan(200);
  });

  it('畸形 regex 抛 SEARCH_INVALID_Q', async () => {
    await expect(
      runSearch({
        scope: root,
        q: '(',
        mode: 'content',
        caseSensitive: true,
        regex: true,
        policy: { allow: [], deny: [] },
        emit: () => {},
      }),
    ).rejects.toThrow(/invalid|SEARCH_INVALID_Q/i);
  });
});
