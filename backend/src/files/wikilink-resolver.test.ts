/**
 * WorkspaceIndex 单测 — wikilink 解析算法 + 索引构建。
 *
 * 覆盖:短名唯一 / broken / multi-match shortest-path / 字节序 tie-break /
 * 含 / 的路径形态(vault root → 当前目录 fallback) / 大小写不敏感 /
 * .markdown 与 .md 等价 / heading & block fragment 解析 / 重复 ensureBuilt 幂等。
 *
 * 详见 docs/plans/obsidian-integration/adrs/003-wikilink-resolution-algorithm.md
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { WorkspaceIndex } from './wikilink-resolver.js';

let cwd: string;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'atr-wikilink-'));
});
afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

function touch(rel: string, content = ''): void {
  const full = join(cwd, rel);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
}

describe('WorkspaceIndex.resolve — short name', () => {
  it('resolves unique short name', async () => {
    touch('notes/foo.md');
    const idx = new WorkspaceIndex(cwd);
    await idx.ensureBuilt();
    expect(idx.resolve('notes/from.md', 'foo').resolved).toBe('notes/foo.md');
    idx.shutdown();
  });

  it('returns broken when no candidate', async () => {
    touch('notes/foo.md');
    const idx = new WorkspaceIndex(cwd);
    await idx.ensureBuilt();
    expect(idx.resolve('notes/from.md', 'missing').broken).toBe(true);
    idx.shutdown();
  });

  it('case insensitive short name', async () => {
    touch('Foo.md');
    const idx = new WorkspaceIndex(cwd);
    await idx.ensureBuilt();
    expect(idx.resolve('x.md', 'FOO').resolved).toBe('Foo.md');
    idx.shutdown();
  });

  it('treats .markdown same as .md', async () => {
    touch('foo.markdown');
    const idx = new WorkspaceIndex(cwd);
    await idx.ensureBuilt();
    expect(idx.resolve('x.md', 'foo').resolved).toBe('foo.markdown');
    idx.shutdown();
  });
});

describe('WorkspaceIndex.resolve — shortest-path heuristic', () => {
  it('picks the one with most common dir segments on multi-match', async () => {
    touch('notes/2024/foo.md');
    touch('archive/foo.md');
    const idx = new WorkspaceIndex(cwd);
    await idx.ensureBuilt();
    // from notes/2026/today.md → notes/2024/foo.md wins(共 'notes/' 一段)
    const r = idx.resolve('notes/2026/today.md', 'foo');
    expect(r.resolved).toBe('notes/2024/foo.md');
    expect(r.candidates?.sort()).toEqual(['archive/foo.md', 'notes/2024/foo.md']);
    idx.shutdown();
  });

  it('tie-breaks by byte order when common segments equal', async () => {
    touch('a/foo.md');
    touch('b/foo.md');
    const idx = new WorkspaceIndex(cwd);
    await idx.ensureBuilt();
    // common = 0 both, byte order 'a' < 'b'
    expect(idx.resolve('root.md', 'foo').resolved).toBe('a/foo.md');
    idx.shutdown();
  });
});

describe('WorkspaceIndex.resolve — path form (with /)', () => {
  it('resolves vault-root-relative path', async () => {
    touch('a/b/c.md');
    const idx = new WorkspaceIndex(cwd);
    await idx.ensureBuilt();
    expect(idx.resolve('other.md', 'a/b/c').resolved).toBe('a/b/c.md');
    idx.shutdown();
  });

  it('falls back to current-dir-relative when vault-root miss', async () => {
    touch('notes/sub/target.md');
    const idx = new WorkspaceIndex(cwd);
    await idx.ensureBuilt();
    // [[sub/target]] from notes/foo.md → notes/sub/target.md
    expect(idx.resolve('notes/foo.md', 'sub/target').resolved).toBe('notes/sub/target.md');
    idx.shutdown();
  });

  it('returns broken when neither vault-root nor current-dir match', async () => {
    touch('only/here.md');
    const idx = new WorkspaceIndex(cwd);
    await idx.ensureBuilt();
    expect(idx.resolve('elsewhere/from.md', 'a/b/c').broken).toBe(true);
    idx.shutdown();
  });
});

describe('WorkspaceIndex.resolve — fragments', () => {
  it('parses heading fragment', async () => {
    touch('notes/foo.md');
    const idx = new WorkspaceIndex(cwd);
    await idx.ensureBuilt();
    const r = idx.resolve('x.md', 'foo#H2');
    expect(r.resolved).toBe('notes/foo.md');
    expect(r.fragment).toEqual({ kind: 'heading', id: 'H2' });
    idx.shutdown();
  });

  it('parses block id fragment', async () => {
    touch('notes/foo.md');
    const idx = new WorkspaceIndex(cwd);
    await idx.ensureBuilt();
    expect(idx.resolve('x.md', 'foo#^abc').fragment).toEqual({ kind: 'block', id: 'abc' });
    idx.shutdown();
  });

  it('accepts absolute `from` path (frontend may send abs path from PreviewTarget)', async () => {
    touch('sub/foo.md');
    const idx = new WorkspaceIndex(cwd);
    await idx.ensureBuilt();
    // 前端 target.path 来自 list-dir,是绝对路径。resolver 应归一为相对 cwd
    const absFrom = join(cwd, 'sub/other.md');
    expect(idx.resolve(absFrom, 'sub/foo').resolved).toBe('sub/foo.md');
    idx.shutdown();
  });

  it('strips alias pipe before resolving (defensive)', async () => {
    touch('notes/foo.md');
    const idx = new WorkspaceIndex(cwd);
    await idx.ensureBuilt();
    // alias 应该由前端 plugin 切掉,但 backend 防御性容错
    expect(idx.resolve('x.md', 'foo|alias').resolved).toBe('notes/foo.md');
    idx.shutdown();
  });
});

describe('WorkspaceIndex.ensureBuilt — concurrency', () => {
  it('serializes concurrent builds (no double-walk)', async () => {
    touch('a.md');
    const idx = new WorkspaceIndex(cwd);
    const promises = [idx.ensureBuilt(), idx.ensureBuilt(), idx.ensureBuilt()];
    await Promise.all(promises);
    expect(idx.resolve('x.md', 'a').resolved).toBe('a.md');
    idx.shutdown();
  });
});
