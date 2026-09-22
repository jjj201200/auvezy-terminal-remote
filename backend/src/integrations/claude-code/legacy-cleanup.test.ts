/**
 * 旧端口镜像残留清理测试(0.18,ADR-002)
 *
 * 镜像命名从 claude-config/<port>/ 迁到 claude-code/<escapedCwd>/ 后,
 * worker 启动时清理按端口命名的旧残留。为防同机混跑新旧版本时误删
 * 旧版实例正在使用的镜像,只清 mtime 超过 24h 的数字目录。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, existsSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { cleanupLegacyPortMirrors } from './config-dir-mirror.js';

/** 把目录 mtime 拨回 N 小时前 */
function ageHours(path: string, hours: number): void {
  const t = new Date(Date.now() - hours * 3600_000);
  utimesSync(path, t, t);
}

describe('cleanupLegacyPortMirrors', () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'atr-legacy-cleanup-'));
  });
  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('清理旧命名 claude-config/ 与新命名 claude-code/ 下的纯数字目录(>24h)', () => {
    const oldPort1 = join(dataDir, 'claude-config', '41999');
    const oldPort2 = join(dataDir, 'claude-code', '41234');
    mkdirSync(oldPort1, { recursive: true });
    mkdirSync(oldPort2, { recursive: true });
    ageHours(oldPort1, 48);
    ageHours(oldPort2, 48);

    cleanupLegacyPortMirrors(dataDir);

    expect(existsSync(oldPort1)).toBe(false);
    expect(existsSync(oldPort2)).toBe(false);
  });

  it('24h 内的数字目录保留(可能被混跑的旧版本实例使用)', () => {
    const fresh = join(dataDir, 'claude-config', '43000');
    mkdirSync(fresh, { recursive: true }); // mtime = now

    cleanupLegacyPortMirrors(dataDir);

    expect(existsSync(fresh)).toBe(true);
  });

  it('按项目命名的镜像目录不受影响', () => {
    const proj = join(dataDir, 'claude-code', '-mnt-d-github-observer');
    mkdirSync(proj, { recursive: true });
    writeFileSync(join(proj, 'settings.json'), '{}');
    ageHours(proj, 72);

    cleanupLegacyPortMirrors(dataDir);

    expect(existsSync(proj)).toBe(true);
  });

  it('两个 base 目录都不存在时 no-op', () => {
    expect(() => cleanupLegacyPortMirrors(dataDir)).not.toThrow();
  });
});
