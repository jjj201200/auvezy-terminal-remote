/**
 * 解码静态图片中的二维码（"上传 / 拍照扫码"路径）
 *
 * 实现:zxing-wasm（reader-only 子路径,~400KB gzipped）
 *
 * 选 zxing-wasm 而非 jsQR / qr-scanner / @zxing/library 的原因:
 *   - jsQR / qr-scanner(底层 jsQR)对屏幕拍照场景识别率低(用户实测 iOS 原生
 *     相机能识别但 jsQR 不能)
 *   - @zxing/library 是 TS 实现,已 maintenance mode(2024 起停滞),识别率
 *     落后 ZXing-C++
 *   - zxing-wasm 是 ZXing-C++ 的 emscripten 编译产物,2026-05 仍在活跃维护;
 *     屏幕拍照 / 倾斜 / 反光鲁棒性显著优于 jsQR
 *
 * iOS 注意:
 *   - iOS WebKit(Safari / Chrome / Edge 在 iOS 上同 WebKit 内核)原生没有
 *     BarcodeDetector,zxing-wasm 是当下最好选择
 *   - WASM 在 iOS Safari 16+ 一律可跑,无需 SharedArrayBuffer / COOP/COEP
 *
 * 默认参数(tryHarder/tryRotate/tryInvert 全开)精度优先,仅限 QRCode 格式
 * 加快解码,不浪费时间在 1D / DataMatrix 上。
 *
 * 失败返回 null,调用方提示用户重试。
 */

import { prepareZXingModule, readBarcodes } from 'zxing-wasm/reader';
// 走包 exports 字段里声明的 './reader/zxing_reader.wasm' 子路径(包内部约定),
// vite ?url 把它当作 asset 处理 → dev 直接服务,build 产 hash 文件到 dist/assets/
import zxingWasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url';

// 模块加载时一次性配置 wasm URL,改 jsDelivr CDN 默认 → 同源资源,LAN 部署也能跑
prepareZXingModule({
  overrides: {
    locateFile: (path: string): string => (path.endsWith('.wasm') ? zxingWasmUrl : path),
  },
});

export async function decodeQrFromFile(file: File): Promise<string | null> {
  try {
    const results = await readBarcodes(file, {
      formats: ['QRCode'],
      tryHarder: true,
      tryRotate: true,
      tryInvert: true,
    });
    for (const r of results) {
      if (r.text) return r.text;
    }
    return null;
  } catch {
    // wasm 加载失败 / 解码异常,返 null 让调用方走"识别失败"路径
    return null;
  }
}
