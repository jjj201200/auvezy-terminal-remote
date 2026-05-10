/**
 * resolveExecutable 单测
 *
 * 用临时目录模拟 PATH，避免依赖具体机器上的 zsh / claude 等命令。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { resolve, delimiter } from 'node:path';
import { tmpdir } from 'node:os';
import { resolveExecutable, listPathExecutables } from './resolve-executable.js';

describe('resolveExecutable', () => {
  let dir1: string;
  let dir2: string;

  beforeEach(() => {
    dir1 = mkdtempSync(resolve(tmpdir(), 'atr-rx1-'));
    dir2 = mkdtempSync(resolve(tmpdir(), 'atr-rx2-'));
  });

  afterEach(() => {
    rmSync(dir1, { recursive: true, force: true });
    rmSync(dir2, { recursive: true, force: true });
  });

  /** 创建一个空的可执行文件（POSIX：chmod +x；Windows：空文件即可） */
  const makeBin = (dir: string, name: string): string => {
    const p = resolve(dir, name);
    writeFileSync(p, '#!/bin/sh\nexit 0\n');
    if (process.platform !== 'win32') chmodSync(p, 0o755);
    return p;
  };

  it('空字符串 / undefined → null', () => {
    expect(resolveExecutable('', { PATH: dir1 })).toBeNull();
  });

  it('PATH 里的命令 → 返回绝对路径', () => {
    const bin = makeBin(dir1, 'mytool');
    const r = resolveExecutable('mytool', { PATH: dir1 });
    expect(r).toBe(bin);
  });

  it('PATH 多段时按优先级返回第一个命中', () => {
    const bin1 = makeBin(dir1, 'mytool');
    makeBin(dir2, 'mytool');
    expect(resolveExecutable('mytool', { PATH: `${dir1}${delimiter}${dir2}` })).toBe(bin1);
    expect(resolveExecutable('mytool', { PATH: `${dir2}${delimiter}${dir1}` })).toBe(
      resolve(dir2, 'mytool'),
    );
  });

  it('PATH 中找不到 → null', () => {
    expect(resolveExecutable('does-not-exist-xyz', { PATH: dir1 })).toBeNull();
  });

  it('绝对路径 + 文件存在 + 可执行 → 返回原路径', () => {
    const bin = makeBin(dir1, 'mytool');
    expect(resolveExecutable(bin, { PATH: '' })).toBe(bin);
  });

  it('绝对路径但文件不存在 → null', () => {
    expect(resolveExecutable('/nonexistent/path/foo', { PATH: '' })).toBeNull();
  });

  it('相对路径（带 /）按 process.cwd() 解析', () => {
    const bin = makeBin(dir1, 'mytool');
    const orig = process.cwd();
    try {
      process.chdir(dir1);
      // 注意：./mytool 含 / → 走"路径分隔符"分支，不走 PATH 查找
      expect(resolveExecutable('./mytool', { PATH: '' })).toBe(bin);
    } finally {
      process.chdir(orig);
    }
  });

  it('PATH 不存在或为空 → null（除非用绝对路径）', () => {
    expect(resolveExecutable('mytool', {})).toBeNull();
    expect(resolveExecutable('mytool', { PATH: '' })).toBeNull();
  });

  // POSIX 才有 X 位概念；Windows 跳过
  if (process.platform !== 'win32') {
    it('POSIX：文件存在但无 X 位 → null', () => {
      const p = resolve(dir1, 'noexec');
      writeFileSync(p, 'data');
      chmodSync(p, 0o644);
      expect(resolveExecutable('noexec', { PATH: dir1 })).toBeNull();
    });
  }
});

describe('listPathExecutables', () => {
  let dir1: string;
  let dir2: string;

  beforeEach(() => {
    dir1 = mkdtempSync(resolve(tmpdir(), 'atr-lpe1-'));
    dir2 = mkdtempSync(resolve(tmpdir(), 'atr-lpe2-'));
  });

  afterEach(() => {
    rmSync(dir1, { recursive: true, force: true });
    rmSync(dir2, { recursive: true, force: true });
  });

  const makeBin = (dir: string, name: string): void => {
    const p = resolve(dir, name);
    writeFileSync(p, '#!/bin/sh\nexit 0\n');
    if (process.platform !== 'win32') chmodSync(p, 0o755);
  };

  it('列出 PATH 各目录里的可执行文件名', () => {
    makeBin(dir1, 'foo');
    makeBin(dir1, 'bar');
    makeBin(dir2, 'baz');
    const list = listPathExecutables({ PATH: `${dir1}${delimiter}${dir2}` });
    expect(list).toContain('foo');
    expect(list).toContain('bar');
    expect(list).toContain('baz');
  });

  it('去重(同名出现在多个 PATH dir)', () => {
    makeBin(dir1, 'dup');
    makeBin(dir2, 'dup');
    const list = listPathExecutables({ PATH: `${dir1}${delimiter}${dir2}` });
    expect(list.filter((x) => x === 'dup').length).toBe(1);
  });

  it('某个 PATH dir 不存在 → 跳过,不抛错', () => {
    makeBin(dir1, 'foo');
    const list = listPathExecutables({
      PATH: `${dir1}${delimiter}/nonexistent/path/xyz`,
    });
    expect(list).toContain('foo');
  });

  it('空 PATH → []', () => {
    expect(listPathExecutables({})).toEqual([]);
    expect(listPathExecutables({ PATH: '' })).toEqual([]);
  });
});
