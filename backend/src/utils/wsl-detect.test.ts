import { describe, it, expect, beforeEach } from 'vitest';
import { isWsl, _resetWslCache } from './wsl-detect.js';

describe('isWsl', () => {
  beforeEach(() => _resetWslCache());

  it('非 Linux 平台直接 false', () => {
    expect(
      isWsl({ platform: 'darwin', readProcVersion: () => 'whatever' }),
    ).toBe(false);
    expect(
      isWsl({ platform: 'win32', readProcVersion: () => 'microsoft' }),
    ).toBe(false);
  });

  it('Linux + /proc/version 含 microsoft → true', () => {
    expect(
      isWsl({
        platform: 'linux',
        readProcVersion: () =>
          'Linux version 5.15.0 (microsoft@WSL2-build) gcc 11',
      }),
    ).toBe(true);
  });

  it('Linux + /proc/version 含 WSL（任意大小写）→ true', () => {
    expect(
      isWsl({
        platform: 'linux',
        readProcVersion: () => 'Linux 5.10 wsl2 Build 22000',
      }),
    ).toBe(true);
  });

  it('Linux 但不是 WSL（裸机 / 容器）→ false', () => {
    expect(
      isWsl({
        platform: 'linux',
        readProcVersion: () =>
          'Linux version 6.1.0-13-amd64 (Debian 6.1.55-1)',
      }),
    ).toBe(false);
  });

  it('/proc/version 读取异常（容器没挂这个文件）→ false', () => {
    expect(
      isWsl({
        platform: 'linux',
        readProcVersion: () => {
          throw new Error('ENOENT');
        },
      }),
    ).toBe(false);
  });
});
