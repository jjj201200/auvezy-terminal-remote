/**
 * shared-token 单测
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { acquireSharedToken } from './shared-token.js';

describe('acquireSharedToken', () => {
  let baseDir: string;
  let path: string;
  let lockDir: string;

  beforeEach(() => {
    baseDir = mkdtempSync(resolve(tmpdir(), 'ocr-stoken-'));
    path = resolve(baseDir, 'config.json');
    lockDir = resolve(baseDir, '.lock');
  });

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true });
  });

  it('文件不存在 → generated + 写盘', async () => {
    const r = await acquireSharedToken({
      path,
      lockDir,
      generateToken: () => 'tok-A',
    });
    expect(r.source).toBe('generated');
    expect(r.token).toBe('tok-A');
    const onDisk = JSON.parse(readFileSync(path, 'utf-8'));
    expect(onDisk.token).toBe('tok-A');
  });

  it('文件已含 token → shared，不重新生成', async () => {
    writeFileSync(path, JSON.stringify({ token: 'pre-existing' }));
    let calls = 0;
    const r = await acquireSharedToken({
      path,
      lockDir,
      generateToken: () => {
        calls++;
        return 'should-not-use';
      },
    });
    expect(r.source).toBe('shared');
    expect(r.token).toBe('pre-existing');
    expect(calls).toBe(0);
  });

  it('文件存在但无 token 字段 → generated（保留其它字段）', async () => {
    writeFileSync(path, JSON.stringify({ fontScale: 1.2 }));
    const r = await acquireSharedToken({
      path,
      lockDir,
      generateToken: () => 'tok-B',
    });
    expect(r.source).toBe('generated');
    const onDisk = JSON.parse(readFileSync(path, 'utf-8'));
    expect(onDisk.token).toBe('tok-B');
    expect(onDisk.fontScale).toBe(1.2);
  });

  it('JSON 损坏 → generated（覆盖损坏内容，不阻塞）', async () => {
    writeFileSync(path, '{not valid');
    const r = await acquireSharedToken({
      path,
      lockDir,
      generateToken: () => 'tok-C',
    });
    expect(r.source).toBe('generated');
    expect(r.token).toBe('tok-C');
    expect(JSON.parse(readFileSync(path, 'utf-8')).token).toBe('tok-C');
  });

  it('并发 5 路 → 全部得到同一个 token；只有一次 generated', async () => {
    let count = 0;
    const calls = await Promise.all(
      Array.from({ length: 5 }, () =>
        acquireSharedToken({
          path,
          lockDir,
          generateToken: () => `tok-${++count}`,
        }),
      ),
    );
    const tokens = new Set(calls.map((r) => r.token));
    expect(tokens.size).toBe(1);
    const generated = calls.filter((r) => r.source === 'generated').length;
    expect(generated).toBe(1);
  });

  it('父目录不存在 → 自动创建', async () => {
    const nested = resolve(baseDir, 'sub1', 'sub2', 'config.json');
    const r = await acquireSharedToken({
      path: nested,
      lockDir: resolve(baseDir, 'sub1', 'sub2', '.lock'),
      generateToken: () => 'tok-D',
    });
    expect(r.source).toBe('generated');
    expect(existsSync(nested)).toBe(true);
  });
});
