import { describe, it, expect } from 'vitest';
import { isWslNatIp, buildPortForwardHint } from './wsl-port-hint.js';

describe('isWslNatIp', () => {
  it('172.16-31.x → true（WSL2 默认 NAT 段）', () => {
    expect(isWslNatIp('172.16.0.1')).toBe(true);
    expect(isWslNatIp('172.20.10.5')).toBe(true);
    expect(isWslNatIp('172.31.255.255')).toBe(true);
  });

  it('172.0-15.x / 172.32+.x → false（不在私有段）', () => {
    expect(isWslNatIp('172.15.0.1')).toBe(false);
    expect(isWslNatIp('172.32.0.1')).toBe(false);
  });

  it('192.168.x / 10.x → false（mirrored / 桥接）', () => {
    expect(isWslNatIp('192.168.0.113')).toBe(false);
    expect(isWslNatIp('10.0.0.5')).toBe(false);
  });

  it('非法 IP → false', () => {
    expect(isWslNatIp('not-an-ip')).toBe(false);
    expect(isWslNatIp('172.16.1')).toBe(false);
  });
});

describe('buildPortForwardHint', () => {
  it('单端口生成 1 条 add 命令', () => {
    const h = buildPortForwardHint([3000], '172.20.10.5');
    expect(h.setupCommands).toHaveLength(2); // $wsl_ip 赋值 + 1 add
    expect(h.setupCommands[1]).toContain('listenport=3000');
    expect(h.setupCommands[1]).toContain('connectaddress=$wsl_ip');
    expect(h.title).toContain('172.20.10.5');
  });

  it('多端口生成多条 add 命令', () => {
    const h = buildPortForwardHint([3000, 3001, 3002], '172.20.10.5');
    expect(h.setupCommands).toHaveLength(4); // 1 var + 3 add
    expect(h.setupCommands[1]).toContain('listenport=3000');
    expect(h.setupCommands[2]).toContain('listenport=3001');
    expect(h.setupCommands[3]).toContain('listenport=3002');
  });

  it('reset 命令固定', () => {
    const h = buildPortForwardHint([3000], '172.20.10.5');
    expect(h.resetCommand).toBe('netsh interface portproxy reset');
  });
});
