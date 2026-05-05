/**
 * network 单测
 */

import { describe, it, expect } from 'vitest';
import {
  isPrivateIp,
  isLinkLocal,
  isLoopbackIp,
  isTailscaleIp,
  detectDisplayIp,
  buildPublicUrl,
} from './network.js';

describe('isPrivateIp', () => {
  it('10/8 私有', () => {
    expect(isPrivateIp('10.0.0.1')).toBe(true);
    expect(isPrivateIp('10.255.255.255')).toBe(true);
  });
  it('172.16/12 私有边界', () => {
    expect(isPrivateIp('172.15.0.1')).toBe(false);
    expect(isPrivateIp('172.16.0.1')).toBe(true);
    expect(isPrivateIp('172.31.255.255')).toBe(true);
    expect(isPrivateIp('172.32.0.1')).toBe(false);
  });
  it('192.168/16 私有', () => {
    expect(isPrivateIp('192.168.1.1')).toBe(true);
    expect(isPrivateIp('192.169.1.1')).toBe(false);
  });
  it('公网 / loopback / link-local 不算私有', () => {
    expect(isPrivateIp('1.1.1.1')).toBe(false);
    expect(isPrivateIp('127.0.0.1')).toBe(false);
    expect(isPrivateIp('169.254.1.1')).toBe(false);
  });
  it('IPv6 与非法字符串返回 false', () => {
    expect(isPrivateIp('::1')).toBe(false);
    expect(isPrivateIp('fe80::1')).toBe(false);
    expect(isPrivateIp('not-an-ip')).toBe(false);
    expect(isPrivateIp('192.168.1')).toBe(false);
  });
});

describe('isLinkLocal', () => {
  it('169.254/16', () => {
    expect(isLinkLocal('169.254.1.1')).toBe(true);
    expect(isLinkLocal('169.255.1.1')).toBe(false);
  });
});

describe('isLoopbackIp', () => {
  it('127/8 全是 loopback', () => {
    expect(isLoopbackIp('127.0.0.1')).toBe(true);
    expect(isLoopbackIp('127.5.5.5')).toBe(true);
  });
  it('::1', () => {
    expect(isLoopbackIp('::1')).toBe(true);
  });
});

describe('isTailscaleIp', () => {
  it('100.64.0.0/10 边界', () => {
    expect(isTailscaleIp('100.64.0.0')).toBe(true);
    expect(isTailscaleIp('100.64.0.1')).toBe(true);
    expect(isTailscaleIp('100.100.0.50')).toBe(true);
    expect(isTailscaleIp('100.127.255.255')).toBe(true);
  });

  it('段外 100.x 不是 Tailscale', () => {
    expect(isTailscaleIp('100.0.0.1')).toBe(false);
    expect(isTailscaleIp('100.63.255.255')).toBe(false);
    expect(isTailscaleIp('100.128.0.0')).toBe(false);
    expect(isTailscaleIp('100.255.255.255')).toBe(false);
  });

  it('其它段全部 false', () => {
    expect(isTailscaleIp('192.168.1.1')).toBe(false);
    expect(isTailscaleIp('10.0.0.1')).toBe(false);
    expect(isTailscaleIp('127.0.0.1')).toBe(false);
    expect(isTailscaleIp('::1')).toBe(false);
    expect(isTailscaleIp('fd7a:115c:a1e0::1')).toBe(false);
  });

  it('非法输入返回 false', () => {
    expect(isTailscaleIp('')).toBe(false);
    expect(isTailscaleIp('100.64')).toBe(false);
    expect(isTailscaleIp('100.x.y.z')).toBe(false);
  });
});

describe('detectDisplayIp', () => {
  it('hostHint 是私有 IP → 直接返回', () => {
    // 不指定 → 走 networkInterfaces；机器配置不可控，只断言"返回值是字符串"
    const ip = detectDisplayIp();
    expect(typeof ip).toBe('string');
    expect(ip.length).toBeGreaterThan(0);
  });

  it('hostHint = 0.0.0.0 → 不视为已指定', () => {
    const ip = detectDisplayIp('0.0.0.0');
    expect(ip).not.toBe('0.0.0.0');
  });

  it('hostHint = 127.0.0.1 → 不视为已指定（让自动检测）', () => {
    const ip = detectDisplayIp('127.0.0.1');
    expect(ip).not.toBe('127.0.0.1'); // 在 WSL/Linux 上至少有一个私有 IP
  });

  it('hostHint = 显式 IP 直接返回', () => {
    expect(detectDisplayIp('203.0.113.5')).toBe('203.0.113.5');
  });
});

describe('buildPublicUrl', () => {
  it('不带 token', () => {
    expect(buildPublicUrl('192.168.1.10', 3000)).toBe('http://192.168.1.10:3000/');
  });
  it('带 token：URL 编码', () => {
    expect(buildPublicUrl('192.168.1.10', 3000, 'a/b+c')).toBe(
      'http://192.168.1.10:3000/?token=a%2Fb%2Bc',
    );
  });
});
