/**
 * 把 public/icons/atr-icon.svg 渲染成 PWA 需要的 PNG 尺寸。
 *
 * iOS / Android / Windows 不同时期对 PWA 图标尺寸要求不一致：
 *  - 192×192：Android Chrome 主屏图标 + 通知 badge
 *  - 512×512：splash screen + install UI 大图
 *  - 180×180：iOS apple-touch-icon（iOS 16 之前不识别 SVG）
 *  - 512×512 maskable：Android 自适应图标，留 safe zone padding
 *
 * 用 @resvg/resvg-js（纯 JS / wasm）渲染，无需系统级 SVG 工具。
 *
 * 用法：node scripts/gen-pwa-icons.mjs
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const svgPath = resolve(root, 'public/icons/atr-icon.svg');
const outDir = resolve(root, 'public/icons');
mkdirSync(outDir, { recursive: true });

const svg = readFileSync(svgPath);

const targets = [
  { name: 'atr-icon-192.png', size: 192 },
  { name: 'atr-icon-512.png', size: 512 },
  { name: 'atr-icon-180.png', size: 180 },
  // maskable 版本：背景填满，原图缩到 safe zone（80% 内）以便 Android 切圆
  { name: 'atr-icon-512-maskable.png', size: 512, maskable: true },
];

for (const t of targets) {
  const opts = {
    fitTo: { mode: 'width', value: t.maskable ? Math.floor(t.size * 0.8) : t.size },
    background: '#0e120e',
  };
  const resvg = new Resvg(svg, opts);
  const png = resvg.render().asPng();

  // maskable 模式：把渲染结果居中放进满尺寸画布
  if (t.maskable) {
    const inner = resvg.render();
    const innerSize = Math.floor(t.size * 0.8);
    const offset = Math.floor((t.size - innerSize) / 2);
    // 简易实现：再渲染一次满尺寸的纯背景，叠加内容
    const bgSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${t.size}" height="${t.size}"><rect width="100%" height="100%" fill="#0e120e"/><image x="${offset}" y="${offset}" width="${innerSize}" height="${innerSize}" href="data:image/svg+xml;base64,${svg.toString('base64')}"/></svg>`;
    const bg = new Resvg(bgSvg, { fitTo: { mode: 'width', value: t.size } });
    writeFileSync(resolve(outDir, t.name), bg.render().asPng());
    console.log(`✓ ${t.name} (${t.size}px maskable)`);
    inner; // unused
  } else {
    writeFileSync(resolve(outDir, t.name), png);
    console.log(`✓ ${t.name} (${t.size}px)`);
  }
}

console.log('done');
