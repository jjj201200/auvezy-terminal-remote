/**
 * SessionsStore 单测
 *
 * 关键点：
 *  - create / validate / remove 路径正确性
 *  - TTL：过期 validate 返回 false 且盘上记录被清
 *  - 损坏 JSON / 不认识的 schema → 空集合不抛
 *  - 并发 create 不会丢条目（withFileLock）
 *  - lastSeenAt 节流：同 1s 内多次 validate 不重复写
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { SessionsStore, normalize } from './sessions-store.js';

describe('SessionsStore', () => {
  let baseDir: string;
  let path: string;
  let lockDir: string;

  beforeEach(() => {
    baseDir = mkdtempSync(resolve(tmpdir(), 'atr-sessions-'));
    path = resolve(baseDir, 'sessions.json');
    lockDir = resolve(baseDir, '.lock');
  });

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true });
  });

  it('create + validate 流转', async () => {
    const store = new SessionsStore({ path, lockDir, sessionTtlMs: 60_000 });
    const sid = await store.create('1.2.3.4');
    expect(typeof sid).toBe('string');
    expect(sid.length).toBeGreaterThan(0);
    expect(await store.validate(sid)).toBe(true);
    expect(store.size()).toBe(1);
  });

  it('validate 不存在的 sessionId 返回 false', async () => {
    const store = new SessionsStore({ path, lockDir, sessionTtlMs: 60_000 });
    expect(await store.validate('nope')).toBe(false);
    expect(await store.validate('')).toBe(false);
  });

  it('remove 后 validate 返回 false', async () => {
    const store = new SessionsStore({ path, lockDir, sessionTtlMs: 60_000 });
    const sid = await store.create('1.2.3.4');
    await store.remove(sid);
    expect(await store.validate(sid)).toBe(false);
    expect(store.size()).toBe(0);
  });

  it('TTL 过期：validate 返回 false 且盘上被清', async () => {
    const store = new SessionsStore({ path, lockDir, sessionTtlMs: 5 });
    const sid = await store.create('1.2.3.4');
    // 等到过期
    await new Promise((r) => setTimeout(r, 20));
    expect(await store.validate(sid)).toBe(false);
    // 盘上已不再持有
    expect(store.size()).toBe(0);
  });

  it('cleanup 批量清掉过期 sessions', async () => {
    const store = new SessionsStore({ path, lockDir, sessionTtlMs: 5 });
    await store.create('a');
    await store.create('b');
    await store.create('c');
    await new Promise((r) => setTimeout(r, 20));
    const removed = await store.cleanup();
    expect(removed).toBe(3);
    expect(store.size()).toBe(0);
  });

  it('损坏 JSON 文件 → 视作空集合，不抛', async () => {
    writeFileSync(path, 'not json {{{', 'utf-8');
    const store = new SessionsStore({ path, lockDir, sessionTtlMs: 60_000 });
    expect(await store.validate('any')).toBe(false);
    expect(store.size()).toBe(0);
    // create 仍能恢复正常
    const sid = await store.create('1.2.3.4');
    expect(await store.validate(sid)).toBe(true);
  });

  it('schema version 不匹配 → 视作空集合', async () => {
    writeFileSync(
      path,
      JSON.stringify({ version: 999, sessions: { x: { createdAt: Date.now(), ip: 'a' } } }),
      'utf-8',
    );
    const store = new SessionsStore({ path, lockDir, sessionTtlMs: 60_000 });
    expect(await store.validate('x')).toBe(false);
    expect(store.size()).toBe(0);
  });

  it('sessions 字段缺 createdAt / ip 的条目被丢弃', async () => {
    writeFileSync(
      path,
      JSON.stringify({
        version: 1,
        sessions: {
          ok: { createdAt: Date.now(), ip: '1.1.1.1' },
          missingIp: { createdAt: Date.now() },
          missingCreatedAt: { ip: '1.1.1.1' },
          notObject: 42,
        },
      }),
      'utf-8',
    );
    const store = new SessionsStore({ path, lockDir, sessionTtlMs: 60_000 });
    expect(await store.validate('ok')).toBe(true);
    expect(await store.validate('missingIp')).toBe(false);
    expect(await store.validate('missingCreatedAt')).toBe(false);
    expect(await store.validate('notObject')).toBe(false);
    expect(store.size()).toBe(1);
  });

  it('并发 create：5 个 Promise.all 都成功，盘上有 5 条', async () => {
    const store = new SessionsStore({ path, lockDir, sessionTtlMs: 60_000 });
    const sids = await Promise.all(
      Array.from({ length: 5 }, (_, i) => store.create(`ip-${i}`)),
    );
    expect(new Set(sids).size).toBe(5);
    expect(store.size()).toBe(5);
    for (const sid of sids) {
      expect(await store.validate(sid)).toBe(true);
    }
  });

  it('文件不存在时不抛，validate 直接返 false', async () => {
    expect(existsSync(path)).toBe(false);
    const store = new SessionsStore({ path, lockDir, sessionTtlMs: 60_000 });
    expect(await store.validate('any')).toBe(false);
    expect(store.size()).toBe(0);
  });

  it('persist 后文件权限是 0o600', async () => {
    const store = new SessionsStore({ path, lockDir, sessionTtlMs: 60_000 });
    await store.create('1.1.1.1');
    const { statSync } = await import('node:fs');
    const mode = statSync(path).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('lastSeenAt 在 1s 节流内不重复写盘', async () => {
    const store = new SessionsStore({ path, lockDir, sessionTtlMs: 60_000 });
    const sid = await store.create('1.1.1.1');
    const initial = JSON.parse(readFileSync(path, 'utf-8')) as {
      sessions: Record<string, { lastSeenAt: number }>;
    };
    const seen0 = initial.sessions[sid]!.lastSeenAt;
    // 立即再 validate 一次（< 1s）
    expect(await store.validate(sid)).toBe(true);
    const after = JSON.parse(readFileSync(path, 'utf-8')) as {
      sessions: Record<string, { lastSeenAt: number }>;
    };
    expect(after.sessions[sid]!.lastSeenAt).toBe(seen0);
  });
});

describe('normalize', () => {
  it('null / 非对象 → 空集合', () => {
    expect(normalize('null').sessions).toEqual({});
    expect(normalize('"str"').sessions).toEqual({});
    expect(normalize('[]').sessions).toEqual({});
  });

  it('lastSeenAt 缺失时回退到 createdAt', () => {
    const data = normalize(
      JSON.stringify({
        version: 1,
        sessions: { x: { createdAt: 1000, ip: 'a' } },
      }),
    );
    expect(data.sessions['x']?.lastSeenAt).toBe(1000);
  });
});
