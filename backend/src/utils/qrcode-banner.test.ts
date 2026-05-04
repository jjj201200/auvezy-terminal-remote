/**
 * qrcode-banner 单测：仅验证基本 contract，不校验具体 ASCII 像素
 */

import { describe, it, expect } from 'vitest';
import { renderQrCode } from './qrcode-banner.js';

describe('renderQrCode', () => {
  it('空 URL → 空字符串', () => {
    expect(renderQrCode('')).toBe('');
  });

  it('合法 URL → 返回非空 ASCII（含多行）', () => {
    const out = renderQrCode('http://192.168.1.10:3000/?token=abc');
    expect(typeof out).toBe('string');
    expect(out.length).toBeGreaterThan(0);
    expect(out).toContain('\n'); // 至少多行
  });

  it('small=false 与 small=true 都能跑通', () => {
    expect(renderQrCode('https://example.com', { small: true })).not.toBe('');
    expect(renderQrCode('https://example.com', { small: false })).not.toBe('');
  });
});
