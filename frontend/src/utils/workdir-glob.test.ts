import { describe, it, expect } from 'vitest';
import {
  extractBase,
  bases,
  matchAllow,
  joinBaseAndRelative,
  normalizePath,
} from './workdir-glob.js';

describe('extractBase', () => {
  it('普通 ** 后缀', () => {
    expect(extractBase('/home/me/projects/**')).toBe('/home/me/projects');
  });
  it('多个通配字符取最前的 segment 边界', () => {
    expect(extractBase('/mnt/d/work/?app/**')).toBe('/mnt/d/work');
  });
  it('字面路径原样返回（去尾部 /）', () => {
    expect(extractBase('/exact/path')).toBe('/exact/path');
    expect(extractBase('/exact/path/')).toBe('/exact/path');
  });
  it('头部即通配 → 返回空（用户写法不规范，跳过）', () => {
    expect(extractBase('**/x')).toBe('');
  });
  it('空字符串', () => {
    expect(extractBase('')).toBe('');
  });
});

describe('bases', () => {
  it('字面去重保留原序', () => {
    expect(
      bases([
        '/home/me/projects/**',
        '/mnt/d/work/**',
        '/home/me/projects/**', // 重复
      ]),
    ).toEqual(['/home/me/projects', '/mnt/d/work']);
  });
  it('包含关系两个都保留', () => {
    expect(
      bases([
        '/home/me/projects/**',
        '/home/me/projects/web/**',
      ]),
    ).toEqual(['/home/me/projects', '/home/me/projects/web']);
  });
  it('跳过头部即通配的条目', () => {
    expect(bases(['**/x', '/a/**'])).toEqual(['/a']);
  });
});

describe('matchAllow', () => {
  it('白名单为空 → 总是通过', () => {
    expect(matchAllow('/anywhere', [])).toBe(true);
  });
  it('** 命中子目录', () => {
    expect(matchAllow('/home/me/projects/foo', ['/home/me/projects/**'])).toBe(true);
  });
  it('未命中', () => {
    expect(matchAllow('/etc/passwd', ['/home/me/**'])).toBe(false);
  });
  it('Windows 反斜杠规范化后匹配', () => {
    expect(matchAllow('D:\\work\\app', ['D:/work/**'])).toBe(true);
  });
});

describe('joinBaseAndRelative', () => {
  it('相对路径为空返回 base', () => {
    expect(joinBaseAndRelative('/home/me', '')).toBe('/home/me');
  });
  it('正常拼接', () => {
    expect(joinBaseAndRelative('/home/me', 'projects/web')).toBe('/home/me/projects/web');
  });
  it('去重多余的 /', () => {
    expect(joinBaseAndRelative('/home/me/', '/projects')).toBe('/home/me/projects');
  });
});

describe('normalizePath', () => {
  it('反斜杠 → 斜杠', () => {
    expect(normalizePath('D:\\a\\b')).toBe('D:/a/b');
  });
});
