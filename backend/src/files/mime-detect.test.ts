/**
 * mime-detect 单元测试
 */

import { describe, it, expect } from 'vitest';
import { detectMime, detectLang } from './mime-detect.js';

describe('detectMime', () => {
  it('.md → text/markdown + previewable=text', () => {
    const r = detectMime('README.md');
    expect(r.mime).toBe('text/markdown');
    expect(r.previewable).toBe('text');
  });

  it('.png → image/png + previewable=image', () => {
    const r = detectMime('logo.png');
    expect(r.mime).toBe('image/png');
    expect(r.previewable).toBe('image');
  });

  it('.svg 优先 image 渲染', () => {
    const r = detectMime('icon.svg');
    expect(r.previewable).toBe('image');
  });

  it('未知扩展 → previewable=none', () => {
    const r = detectMime('blob.xyz123');
    expect(r.previewable).toBe('none');
    expect(r.mime).toBe('application/octet-stream');
  });

  it('无扩展但全名命中(Makefile / Dockerfile)→ text', () => {
    expect(detectMime('Makefile').previewable).toBe('text');
    expect(detectMime('Dockerfile').previewable).toBe('text');
  });

  it('大小写不敏感扩展(.PNG / .Md)', () => {
    expect(detectMime('a.PNG').previewable).toBe('image');
    expect(detectMime('b.Md').previewable).toBe('text');
  });
});

describe('detectLang', () => {
  it('.ts → ts', () => expect(detectLang('a.ts')).toBe('ts'));
  it('.tsx → tsx', () => expect(detectLang('a.tsx')).toBe('tsx'));
  it('.md → markdown', () => expect(detectLang('a.md')).toBe('markdown'));
  it('.yml → yaml', () => expect(detectLang('a.yml')).toBe('yaml'));
  it('未知 → txt', () => expect(detectLang('a.xyz')).toBe('txt'));
});
