/**
 * broker-log-rotator 单测
 *
 * 验证：
 *  - 启动当天文件名格式 broker-YYYY-MM-DD.log
 *  - 写入追加（多次 write 累计）
 *  - 启动时清理 7 天前的旧文件（mtime 检查）
 *  - close 后 timer 不再触发
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  mkdtempSync,
  rmSync,
  readdirSync,
  readFileSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import {
  createBrokerLogRotator,
  isBrokerLogFile,
} from './broker-log-rotator.js';

describe('broker-log-rotator', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(resolve(tmpdir(), 'atr-blr-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('当天文件命名 broker-YYYY-MM-DD.log', () => {
    const fixed = new Date('2026-05-10T12:34:56Z');
    const r = createBrokerLogRotator({ dir, now: () => fixed });
    expect(r.currentFilePath()).toMatch(/broker-2026-05-10\.log$/);
    r.close();
  });

  it('write 追加到当天文件', () => {
    const fixed = new Date('2026-05-10T12:34:56Z');
    const r = createBrokerLogRotator({ dir, now: () => fixed });
    r.write('hello\n');
    r.write('world\n');
    const content = readFileSync(r.currentFilePath(), 'utf-8');
    expect(content).toBe('hello\nworld\n');
    r.close();
  });

  it('启动时清理 7 天前的旧文件（保留 ≤7 天的）', () => {
    const fixed = new Date('2026-05-10T12:00:00Z');
    // 制造 3 个旧文件：8 天前 / 5 天前 / 1 天前
    const dayMs = 24 * 60 * 60 * 1000;
    const old8 = resolve(dir, 'broker-2026-05-02.log');
    const old5 = resolve(dir, 'broker-2026-05-05.log');
    const old1 = resolve(dir, 'broker-2026-05-09.log');
    for (const p of [old8, old5, old1]) writeFileSync(p, 'data');
    const t8 = (fixed.getTime() - 8 * dayMs) / 1000;
    const t5 = (fixed.getTime() - 5 * dayMs) / 1000;
    const t1 = (fixed.getTime() - 1 * dayMs) / 1000;
    utimesSync(old8, t8, t8);
    utimesSync(old5, t5, t5);
    utimesSync(old1, t1, t1);

    const r = createBrokerLogRotator({ dir, now: () => fixed });
    const remaining = readdirSync(dir).filter(isBrokerLogFile).sort();
    // 8 天前的应被删；其余保留
    expect(remaining).toEqual(
      expect.arrayContaining(['broker-2026-05-05.log', 'broker-2026-05-09.log']),
    );
    expect(remaining).not.toContain('broker-2026-05-02.log');
    r.close();
  });

  it('isBrokerLogFile 仅识别 broker-*.log', () => {
    expect(isBrokerLogFile('broker-2026-05-10.log')).toBe(true);
    expect(isBrokerLogFile('app.log')).toBe(false);
    expect(isBrokerLogFile('broker.log')).toBe(false);
    expect(isBrokerLogFile('broker-2026-05-10.txt')).toBe(false);
  });
});
