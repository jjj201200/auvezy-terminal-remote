/**
 * entry-discovery 单测
 *
 * 主要验证排序与 isDefault 标记。networkInterfaces 的真实结果不可控（取决于
 * 跑测试的机器网卡），所以这里只测 buildEntryUrl + kindLabel；discoverEntries
 * 的排序逻辑通过 entry-prompt 的集成测覆盖（用 mock candidates）。
 */

import { describe, it, expect } from 'vitest';
import { buildEntryUrl, kindLabel } from './entry-discovery.js';

describe('buildEntryUrl', () => {
  it('IPv4 → 直接拼', () => {
    expect(buildEntryUrl('192.168.1.4', 3000, 'abc')).toBe(
      'http://192.168.1.4:3000/i/abc/',
    );
  });

  it('IPv6 → 加方括号', () => {
    expect(buildEntryUrl('fe80::1', 3000, 'abc')).toBe(
      'http://[fe80::1]:3000/i/abc/',
    );
  });

  it('hostname (无冒号) → 直接拼', () => {
    expect(buildEntryUrl('wsl.tail.ts.net', 3000, 'abc')).toBe(
      'http://wsl.tail.ts.net:3000/i/abc/',
    );
  });

  it('带 token → URL 末尾追加 ?token= (encoded)', () => {
    expect(buildEntryUrl('192.168.1.4', 3000, 'abc', { token: 'plain-tok' }))
      .toBe('http://192.168.1.4:3000/i/abc/?token=plain-tok');
  });

  it('token 含特殊字符 → encodeURIComponent', () => {
    expect(buildEntryUrl('192.168.1.4', 3000, 'abc', { token: 'a/b+c=d' }))
      .toBe('http://192.168.1.4:3000/i/abc/?token=a%2Fb%2Bc%3Dd');
  });

  it('token 为空字符串 → 不带 query', () => {
    expect(buildEntryUrl('192.168.1.4', 3000, 'abc', { token: '' }))
      .toBe('http://192.168.1.4:3000/i/abc/');
  });
});

describe('kindLabel', () => {
  it.each([
    ['tailscale', 'Tailscale'],
    ['lan', 'LAN'],
    ['ipv6', 'IPv6'],
    ['loopback', 'loopback'],
    ['other', 'other'],
  ] as const)('%s → %s', (k, label) => {
    expect(kindLabel(k)).toBe(label);
  });
});
