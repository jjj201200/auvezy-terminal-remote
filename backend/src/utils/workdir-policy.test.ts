import { describe, it, expect } from 'vitest';
import { checkWorkdir } from './workdir-policy.js';

describe('checkWorkdir', () => {
  describe('黑名单', () => {
    it('cwd 命中黑名单 → 拒绝（含 reason 和 matchedPattern）', () => {
      const r = checkWorkdir('/etc/cron.d', undefined, ['/etc/**']);
      expect(r).not.toBeNull();
      expect(r?.matchedPattern).toBe('/etc/**');
      expect(r?.reason).toContain('黑名单');
    });

    it('cwd 不在黑名单 → 通过', () => {
      const r = checkWorkdir('/home/me/proj', undefined, ['/etc/**', '/root/**']);
      expect(r).toBeNull();
    });

    it('黑名单空数组 → 跳过黑名单这一关', () => {
      const r = checkWorkdir('/etc/cron.d', undefined, []);
      expect(r).toBeNull();
    });

    it('黑名单 undefined → 跳过黑名单这一关', () => {
      const r = checkWorkdir('/etc/cron.d', undefined, undefined);
      expect(r).toBeNull();
    });
  });

  describe('白名单', () => {
    it('白名单非空且 cwd 命中 → 通过', () => {
      const r = checkWorkdir(
        '/home/me/proj/api',
        ['/home/me/**', '/mnt/d/work/**'],
        undefined,
      );
      expect(r).toBeNull();
    });

    it('白名单非空且 cwd 不命中 → 拒绝', () => {
      const r = checkWorkdir(
        '/var/log/foo',
        ['/home/me/**', '/mnt/d/work/**'],
        undefined,
      );
      expect(r).not.toBeNull();
      expect(r?.reason).toContain('白名单');
    });

    it('白名单为空数组 → 视为不限制', () => {
      const r = checkWorkdir('/anywhere/random', [], undefined);
      expect(r).toBeNull();
    });

    it('白名单 undefined → 视为不限制', () => {
      const r = checkWorkdir('/anywhere/random', undefined, undefined);
      expect(r).toBeNull();
    });
  });

  describe('黑名单优先于白名单', () => {
    it('cwd 同时命中白和黑 → 黑名单生效（拒绝）', () => {
      const r = checkWorkdir(
        '/home/me/.ssh',
        ['/home/me/**'],
        ['/home/me/.ssh/**', '/home/me/.ssh'],
      );
      expect(r).not.toBeNull();
      expect(r?.reason).toContain('黑名单');
    });
  });

  describe('glob 模式匹配', () => {
    it('** 递归通配', () => {
      expect(checkWorkdir('/a/b/c/d', undefined, ['/a/**'])).not.toBeNull();
      // picomatch 行为：/a/** 同时命中 /a 自身（globstar 含目录本身）
      // 这是相对于 minimatch 默认值的不同 —— 对我们安全语义是更稳的（连根目录都拦下）
      expect(checkWorkdir('/a', undefined, ['/a/**'])).not.toBeNull();
    });

    it('* 单层通配', () => {
      expect(checkWorkdir('/home/me/proj', ['/home/*/proj'], undefined)).toBeNull();
      expect(
        checkWorkdir('/home/me/sub/proj', ['/home/*/proj'], undefined),
      ).not.toBeNull(); // * 不跨 /
    });

    it('点开头目录可被 * 命中（dot:true）', () => {
      // .config 这种隐藏目录默认 picomatch dot:false 时不被 * 命中
      // 我们的 checkWorkdir 显式打开 dot:true
      expect(
        checkWorkdir('/home/me/.config', ['/home/me/**'], undefined),
      ).toBeNull();
    });
  });

  describe('Windows 反斜杠路径', () => {
    it('反斜杠 cwd 自动规范化为 forward slash', () => {
      // picomatch 是 unix 风格，我们规范化反斜杠让 Windows 用户也能配 unix-style pattern
      const r = checkWorkdir(
        'D:\\github\\proj',
        ['D:/github/**'],
        undefined,
      );
      expect(r).toBeNull();
    });
  });

  describe('默认敏感路径', () => {
    const defaultDeny = ['/etc/**', '/root/**', '/sys/**', '/proc/**'];

    it.each([
      ['/etc/passwd', '/etc/**'],
      ['/etc/cron.d/atr', '/etc/**'],
      ['/root/.ssh', '/root/**'],
      ['/sys/class/net', '/sys/**'],
      ['/proc/1', '/proc/**'],
    ])('%s 应被默认黑名单 %s 拦下', (cwd, expected) => {
      const r = checkWorkdir(cwd, undefined, defaultDeny);
      expect(r?.matchedPattern).toBe(expected);
    });

    it('用户家目录不被默认黑名单影响', () => {
      const r = checkWorkdir('/home/me/proj', undefined, defaultDeny);
      expect(r).toBeNull();
    });
  });
});
