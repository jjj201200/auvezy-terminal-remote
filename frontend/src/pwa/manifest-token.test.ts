import { describe, it, expect, beforeEach } from 'vitest';
import { updateManifestWithToken } from './manifest-token.js';

describe('updateManifestWithToken', () => {
  beforeEach(() => {
    document.head.innerHTML = '';
  });

  it('给 <link rel=manifest> href 拼上 token query', () => {
    const link = document.createElement('link');
    link.rel = 'manifest';
    link.setAttribute('href', '/manifest.webmanifest');
    document.head.appendChild(link);

    updateManifestWithToken('abc123');

    expect(link.getAttribute('href')).toBe('/manifest.webmanifest?token=abc123');
  });

  it('已有 token 时覆盖,不重复拼 query', () => {
    const link = document.createElement('link');
    link.rel = 'manifest';
    link.setAttribute('href', '/manifest.webmanifest?token=old');
    document.head.appendChild(link);

    updateManifestWithToken('new');

    expect(link.getAttribute('href')).toBe('/manifest.webmanifest?token=new');
  });

  it('特殊字符 token 走 URL encode', () => {
    const link = document.createElement('link');
    link.rel = 'manifest';
    link.setAttribute('href', '/manifest.webmanifest');
    document.head.appendChild(link);

    updateManifestWithToken('a/b+c');

    // URLSearchParams.set 走标准 URL encode:`/` → %2F, `+` → %2B
    expect(link.getAttribute('href')).toBe('/manifest.webmanifest?token=a%2Fb%2Bc');
  });

  it('空 token 不动 href', () => {
    const link = document.createElement('link');
    link.rel = 'manifest';
    link.setAttribute('href', '/manifest.webmanifest');
    document.head.appendChild(link);

    updateManifestWithToken('');

    expect(link.getAttribute('href')).toBe('/manifest.webmanifest');
  });

  it('找不到 <link rel=manifest> 时静默', () => {
    expect(() => updateManifestWithToken('abc')).not.toThrow();
  });

  it('同 token 重复调跳过 setAttribute(避免触发 manifest 重 fetch)', () => {
    const link = document.createElement('link');
    link.rel = 'manifest';
    link.setAttribute('href', '/manifest.webmanifest?token=abc');
    document.head.appendChild(link);
    let writes = 0;
    const orig = link.setAttribute.bind(link);
    link.setAttribute = (name: string, value: string) => {
      if (name === 'href') writes++;
      orig(name, value);
    };

    updateManifestWithToken('abc');
    expect(writes).toBe(0);

    updateManifestWithToken('different');
    expect(writes).toBe(1);
  });
});
