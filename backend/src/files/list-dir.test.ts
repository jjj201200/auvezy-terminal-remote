/**
 * listDir 单元测试
 *
 * 真实 tmp 目录 fixture,不 mock fs。
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listDir } from './list-dir.js';

describe('listDir', () => {
  let root: string;

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'fb-list-'));
    mkdirSync(join(root, 'sub'));
    writeFileSync(join(root, 'a.txt'), 'a');
    writeFileSync(join(root, 'b.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    writeFileSync(join(root, '.hidden'), 'x');
    symlinkSync(join(root, 'a.txt'), join(root, 'lnk'));
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('列出全部条目(含隐藏)', async () => {
    const entries = await listDir(root);
    const names = entries.map((e) => e.name).sort();
    expect(names).toEqual(['.hidden', 'a.txt', 'b.png', 'lnk', 'sub']);
  });

  it('排序:目录优先,组内字节序升序(符号<数字<字母)', async () => {
    const entries = await listDir(root);
    // sub 是唯一目录 → 排第一;其余 file/symlink 组按字节序:
    // '.'(0x2E) < 'a' < 'b' < 'l'
    expect(entries.map((e) => e.name)).toEqual(['sub', '.hidden', 'a.txt', 'b.png', 'lnk']);
  });

  it('hidden 字段正确', async () => {
    const entries = await listDir(root);
    const h = entries.find((e) => e.name === '.hidden')!;
    expect(h.hidden).toBe(true);
    const a = entries.find((e) => e.name === 'a.txt')!;
    expect(a.hidden).toBe(false);
  });

  it('文件标记 previewable', async () => {
    const entries = await listDir(root);
    const a = entries.find((e) => e.name === 'a.txt')!;
    expect(a.previewable).toBe('text');
    expect(a.kind).toBe('file');
    const b = entries.find((e) => e.name === 'b.png')!;
    expect(b.previewable).toBe('image');
  });

  it('目录条目 size = 0 且无 previewable', async () => {
    const entries = await listDir(root);
    const sub = entries.find((e) => e.name === 'sub')!;
    expect(sub.kind).toBe('dir');
    expect(sub.size).toBe(0);
    expect(sub.previewable).toBeUndefined();
  });

  it('symlink 标记 kind=symlink', async () => {
    const entries = await listDir(root);
    const lnk = entries.find((e) => e.name === 'lnk')!;
    expect(lnk.kind).toBe('symlink');
  });
});
