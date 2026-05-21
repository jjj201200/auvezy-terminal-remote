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
  it('.mjs → js', () => expect(detectLang('a.mjs')).toBe('js'));
  it('.cjs → js', () => expect(detectLang('a.cjs')).toBe('js'));
  it('.mts → ts', () => expect(detectLang('a.mts')).toBe('ts'));
  it('.cts → ts', () => expect(detectLang('a.cts')).toBe('ts'));
  it('.jsonc → jsonc', () => expect(detectLang('a.jsonc')).toBe('jsonc'));
  it('.vue → vue', () => expect(detectLang('a.vue')).toBe('vue'));
  it('.svelte → svelte', () => expect(detectLang('a.svelte')).toBe('svelte'));
  it('.astro → astro', () => expect(detectLang('a.astro')).toBe('astro'));
  it('.svg → xml(用于源码预览)', () => expect(detectLang('a.svg')).toBe('xml'));
  it('未知 → txt', () => expect(detectLang('a.xyz')).toBe('txt'));
});

describe('detectMime/detectLang 全名命中', () => {
  it('package.json → json', () => {
    expect(detectMime('package.json').mime).toBe('application/json');
    expect(detectLang('package.json')).toBe('json');
  });
  it('tsconfig.json → jsonc(允许注释)', () => {
    expect(detectLang('tsconfig.json')).toBe('jsonc');
  });
  it('pnpm-workspace.yaml → yaml', () => {
    expect(detectLang('pnpm-workspace.yaml')).toBe('yaml');
  });
  it('pnpm-lock.yaml → yaml', () => {
    expect(detectLang('pnpm-lock.yaml')).toBe('yaml');
  });
  it('Cargo.toml → toml', () => {
    expect(detectLang('Cargo.toml')).toBe('toml');
  });
  it('.gitignore → txt(shiki 无 ignore grammar,降级)', () => {
    expect(detectLang('.gitignore')).toBe('txt');
  });
  it('.env → dotenv', () => {
    expect(detectLang('.env')).toBe('dotenv');
  });
  it('.env.production → dotenv', () => {
    expect(detectLang('.env.production')).toBe('dotenv');
  });
  it('.atrrc → json(项目主配置)', () => {
    expect(detectLang('.atrrc')).toBe('json');
  });
  it('Dockerfile → docker', () => {
    expect(detectLang('Dockerfile')).toBe('docker');
  });
  it('Makefile → makefile', () => {
    expect(detectLang('Makefile')).toBe('makefile');
  });
  it('README.md → markdown(全名变体)', () => {
    expect(detectLang('README.md')).toBe('markdown');
  });
  it('LICENSE(无扩展)→ txt', () => {
    expect(detectLang('LICENSE')).toBe('txt');
  });
  it('CHANGELOG.md → markdown', () => {
    expect(detectLang('CHANGELOG.md')).toBe('markdown');
  });
});
