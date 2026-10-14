/**
 * recent-files service 单测(localStorage,每用例清理)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  pushRecentFile,
  getRecentFiles,
  clearRecentFiles,
} from './recent-files.js';

beforeEach(() => {
  localStorage.clear();
});

describe('recent-files', () => {
  it('记录与读取:新→旧排序,limit=0 不记录', () => {
    pushRecentFile('i1', { kind: 'text', path: '/a.md', name: 'a.md' }, 20);
    pushRecentFile('i1', { kind: 'text', path: '/b.md', name: 'b.md' }, 20);
    expect(getRecentFiles('i1').map((e) => e.target.path)).toEqual(['/b.md', '/a.md']);

    localStorage.clear();
    pushRecentFile('i1', { kind: 'text', path: '/a.md', name: 'a.md' }, 0);
    expect(getRecentFiles('i1')).toEqual([]);
  });

  it('同路径去重(重看刷新到最前,不重复)', () => {
    pushRecentFile('i1', { kind: 'text', path: '/a', name: 'a' }, 20);
    pushRecentFile('i1', { kind: 'text', path: '/b', name: 'b' }, 20);
    pushRecentFile('i1', { kind: 'text', path: '/a', name: 'a' }, 20);
    const list = getRecentFiles('i1');
    expect(list).toHaveLength(2);
    expect(list[0]!.target.path).toBe('/a');
  });

  it('上限砍尾;-1 不限', () => {
    for (let i = 0; i < 5; i += 1) {
      pushRecentFile('i1', { kind: 'text', path: `/f${i}`, name: `f${i}` }, 3);
    }
    expect(getRecentFiles('i1')).toHaveLength(3);
    expect(getRecentFiles('i1')[0]!.target.path).toBe('/f4');

    localStorage.clear();
    for (let i = 0; i < 5; i += 1) {
      pushRecentFile('i1', { kind: 'text', path: `/f${i}`, name: `f${i}` }, -1);
    }
    expect(getRecentFiles('i1')).toHaveLength(5);
  });

  it('实例隔离:get/clear 只作用本实例', () => {
    pushRecentFile('i1', { kind: 'text', path: '/x', name: 'x' }, 20);
    pushRecentFile('i2', { kind: 'text', path: '/y', name: 'y' }, 20);
    expect(getRecentFiles('i1').map((e) => e.target.path)).toEqual(['/x']);
    clearRecentFiles('i1');
    expect(getRecentFiles('i1')).toEqual([]);
    expect(getRecentFiles('i2')).toHaveLength(1);
  });
});
