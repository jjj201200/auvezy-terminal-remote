/**
 * resolveSafePath 单元测试
 *
 * 用真实 tmp 目录 + symlink 做 fixture(不 mock fs)。
 * 与 design.md §5.1 三段闸对齐:resolve → realpath → checkWorkdir。
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, symlinkSync, rmSync } from 'node:fs';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveSafePath } from './path-resolver.js';
import { FileError } from '../errors.js';
import { ErrorCode } from 'auvezy-terminal-remote-shared';

describe('resolveSafePath', () => {
  let root: string;
  let cwd: string;
  let cwdReal: string;
  let outsideReal: string;

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'fb-resolve-'));
    cwd = join(root, 'work');
    mkdirSync(cwd);
    mkdirSync(join(cwd, 'sub'));
    writeFileSync(join(cwd, 'file.txt'), 'hi');
    writeFileSync(join(cwd, 'sub', 'inner.txt'), 'inner');
    // symlink 指向 cwd 外:用于"symlink 解到 deny 区"测试
    mkdirSync(join(root, 'outside'));
    writeFileSync(join(root, 'outside', 'secret'), 'x');
    symlinkSync(join(root, 'outside'), join(cwd, 'link-out'));
    // 解一次 realpath,后续断言用真路径(tmp 在 macOS / WSL 上可能是 symlink)
    cwdReal = realpathSync(cwd);
    outsideReal = realpathSync(join(root, 'outside'));
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('相对路径"."解析为 cwd', () => {
    const r = resolveSafePath(cwd, '.', { allow: [], deny: [] });
    expect(r).toBe(cwdReal);
  });

  it('相对路径 sub 解析为 cwd/sub', () => {
    const r = resolveSafePath(cwd, 'sub', { allow: [], deny: [] });
    expect(r).toBe(join(cwdReal, 'sub'));
  });

  it('绝对路径直接接受(在 deny 外)', () => {
    const r = resolveSafePath(cwd, cwd, { allow: [], deny: [] });
    expect(r).toBe(cwdReal);
  });

  it('symlink 解到 cwd 外的目录,deny 命中时拒', () => {
    let caught: unknown;
    try {
      resolveSafePath(cwd, 'link-out', {
        allow: [],
        deny: [`${outsideReal}/**`, outsideReal],
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(FileError);
    expect((caught as FileError).code).toBe(ErrorCode.PATH_FORBIDDEN);
  });

  it('不存在的路径抛 PATH_NOT_FOUND', () => {
    let caught: unknown;
    try {
      resolveSafePath(cwd, 'nope-xxx', { allow: [], deny: [] });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(FileError);
    expect((caught as FileError).code).toBe(ErrorCode.PATH_NOT_FOUND);
  });

  it('allow 非空且未命中抛 PATH_FORBIDDEN', () => {
    let caught: unknown;
    try {
      resolveSafePath(cwd, '.', { allow: ['/never/**'], deny: [] });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(FileError);
    expect((caught as FileError).code).toBe(ErrorCode.PATH_FORBIDDEN);
  });

  it('deny 命中抛 PATH_FORBIDDEN', () => {
    let caught: unknown;
    try {
      resolveSafePath(cwd, '.', { allow: [], deny: [`${cwdReal}/**`, cwdReal] });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(FileError);
    expect((caught as FileError).code).toBe(ErrorCode.PATH_FORBIDDEN);
  });

  it('绝对路径指向 cwd 外被拒(cwd 硬墙)', () => {
    let caught: unknown;
    try {
      // root 是 cwd 的父,policy 完全空 → 但 cwd 硬墙仍应拒
      resolveSafePath(cwd, root, { allow: [], deny: [] });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(FileError);
    expect((caught as FileError).code).toBe(ErrorCode.PATH_FORBIDDEN);
  });

  it('相对 ".." 越过 cwd 被拒(cwd 硬墙)', () => {
    let caught: unknown;
    try {
      resolveSafePath(cwd, '..', { allow: [], deny: [] });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(FileError);
    expect((caught as FileError).code).toBe(ErrorCode.PATH_FORBIDDEN);
  });

  it('cwd 自身允许(边界 inclusive)', () => {
    const r = resolveSafePath(cwd, cwd, { allow: [], deny: [] });
    expect(r).toBe(cwdReal);
  });

  it('同名前缀目录(/work-out)不视作 cwd(/work) 的子', () => {
    // 临时建一个同名前缀目录 /<root>/work-out,resolveSafePath 应拒
    const sibling = join(root, 'work-out');
    mkdirSync(sibling);
    let caught: unknown;
    try {
      resolveSafePath(cwd, sibling, { allow: [], deny: [] });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(FileError);
    expect((caught as FileError).code).toBe(ErrorCode.PATH_FORBIDDEN);
  });
});
