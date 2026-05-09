/**
 * 解码静态图片中的二维码（用于 iOS LAN HTTP 下的"拍照扫码"路径）
 *
 * 流程：
 *   File → ImageBitmap（或 <img> + load）→ canvas.drawImage → getImageData
 *   → jsQR(data, w, h) → string | null
 *
 * 设计：
 *   - 优先 createImageBitmap（更快，主流浏览器都支持包括 iOS Safari 15+）
 *   - 兜底用 <img>.decode() + canvas（老 iOS / 兼容性场景）
 *   - 如果第一次解码失败，可以通过反色再试一次（白底黑码 vs 黑底白码）
 *   - 失败返回 null，调用方提示用户重拍
 */

import jsQR from 'jsqr';

export async function decodeQrFromFile(file: File): Promise<string | null> {
  const bitmap = await loadImageBitmap(file);
  if (!bitmap) return null;

  const w = bitmap.width;
  const h = bitmap.height;
  if (w === 0 || h === 0) return null;

  // 大图缩放：jsQR 解码 O(像素数)，4000x3000 拍照图会卡 200-500ms。
  // 缩到长边 1024 已经足够保留二维码细节
  const MAX_SIDE = 1024;
  const scale = Math.min(1, MAX_SIDE / Math.max(w, h));
  const tw = Math.round(w * scale);
  const th = Math.round(h * scale);

  const canvas = document.createElement('canvas');
  canvas.width = tw;
  canvas.height = th;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(bitmap, 0, 0, tw, th);
  const imageData = ctx.getImageData(0, 0, tw, th);

  // 先按原色解一次；失败再尝试反色（处理黑底白码或低对比度照片）
  let result = jsQR(imageData.data, imageData.width, imageData.height, {
    inversionAttempts: 'attemptBoth',
  });

  return result?.data ?? null;
}

/** 把 File 加载成可绘制对象；优先 createImageBitmap，回退 <img>.decode() */
async function loadImageBitmap(
  file: File,
): Promise<ImageBitmap | HTMLImageElement | null> {
  // ImageBitmap 路径（快）
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file);
    } catch {
      /* fall through to <img> */
    }
  }

  // <img> 路径（兼容性兜底）
  return await new Promise<HTMLImageElement | null>((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    img.src = url;
  });
}
