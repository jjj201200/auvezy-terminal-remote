/**
 * readTextFile 单元测试
 *
 * 真实 tmp fixture,覆盖三段闸:
 *  - 字节级 NUL 闸
 *  - 2 MiB 截断
 *  - 字符级 replacement char 密度闸
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readTextFile } from './read-file.js';
import { FileError } from '../errors.js';
import { ErrorCode, FILE_READ_MAX_BYTES } from 'auvezy-terminal-remote-shared';

describe('readTextFile', () => {
  let root: string;

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'fb-read-'));
    writeFileSync(join(root, 'a.txt'), 'hello');
    // NUL 字节的二进制
    writeFileSync(join(root, 'bin.dat'), Buffer.from([0x00, 0x01, 0x02, 0x03]));
    // 超大文本(3 MiB,全 'a')
    writeFileSync(join(root, 'big.txt'), Buffer.alloc(3 * 1024 * 1024, 0x61));
    // 非法 UTF-8(全部 0xFE) → 解码后大量 �
    writeFileSync(join(root, 'badenc.txt'), Buffer.alloc(1024, 0xfe));
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('正常读 a.txt', async () => {
    const r = await readTextFile(join(root, 'a.txt'));
    expect(r.content).toBe('hello');
    expect(r.size).toBe(5);
    expect(r.truncated).toBe(false);
  });

  it('NUL 字节命中抛 FILE_BINARY', async () => {
    let caught: unknown;
    try {
      await readTextFile(join(root, 'bin.dat'));
    } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(FileError);
    expect((caught as FileError).code).toBe(ErrorCode.FILE_BINARY);
  });

  it('超大文本被截断到 2 MiB', async () => {
    const r = await readTextFile(join(root, 'big.txt'));
    expect(r.truncated).toBe(true);
    expect(Buffer.byteLength(r.content, 'utf8')).toBeLessThanOrEqual(FILE_READ_MAX_BYTES);
    expect(r.size).toBe(3 * 1024 * 1024);
  });

  it('替换字符密度 >5% 抛 FILE_BINARY', async () => {
    let caught: unknown;
    try {
      await readTextFile(join(root, 'badenc.txt'));
    } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(FileError);
    expect((caught as FileError).code).toBe(ErrorCode.FILE_BINARY);
  });
});
