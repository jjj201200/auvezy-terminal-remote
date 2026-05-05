/**
 * qrcode-banner 单测：仅验证基本 contract，不校验具体 ASCII 像素
 */

import { describe, it, expect } from 'vitest';
import { renderQrCode } from './qrcode-banner.js';

describe('renderQrCode', () => {
  it('空 URL → 空字符串', async () => {
    expect(await renderQrCode('')).toBe('');
  });

  it('合法 URL → 返回非空字符串（含多行）', async () => {
    const out = await renderQrCode('http://192.168.1.10:3000/?token=abc');
    expect(typeof out).toBe('string');
    expect(out.length).toBeGreaterThan(0);
    expect(out).toContain('\n');
  });

  it('errorCorrectionLevel L 比 H 更紧凑', async () => {
    const longUrl = 'http://192.168.1.10:3000/?token=' + 'a'.repeat(64);
    const low = await renderQrCode(longUrl, { errorCorrectionLevel: 'L' });
    const high = await renderQrCode(longUrl, { errorCorrectionLevel: 'H' });
    expect(low.length).toBeGreaterThan(0);
    expect(high.length).toBeGreaterThan(0);
    // 高纠错码 cell 数更多
    expect(high.length).toBeGreaterThanOrEqual(low.length);
  });
});
