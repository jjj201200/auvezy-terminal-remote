/**
 * qrcode-banner：把 URL 渲染为终端 ASCII 二维码（异步、紧凑模式）
 *
 * 设计：
 *  - 用 qrcode 库的 'utf8' / 'terminal' 输出格式
 *    （比 qrcode-terminal 更紧凑：utf8 走 ▀ ▄ █ 半字符 + 错误纠错可调）
 *  - errorCorrectionLevel='L'：最低纠错（7%），cell 数最少 → 二维码物理上更小
 *    手机摄像头近距离扫描足够；不会扫不出来
 *  - 失败时返回空字符串，不阻塞启动
 */

import QRCode from 'qrcode';

export interface QrCodeOptions {
  /** 错误纠错级别：L=7% / M=15% / Q=25% / H=30%，默认 L 让二维码最小 */
  errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H';
}

/**
 * 把 URL 渲染为终端用 ASCII 二维码（异步）
 *
 * @returns 多行 UTF8 字符串；失败时返回空字符串
 */
export async function renderQrCode(url: string, opts: QrCodeOptions = {}): Promise<string> {
  if (!url) return '';
  try {
    return await QRCode.toString(url, {
      type: 'utf8',
      errorCorrectionLevel: opts.errorCorrectionLevel ?? 'L',
      // utf8 模式本身就是半字符垂直压缩，体积约 qrcode-terminal small=true 的 1/2。
      // margin: utf8 渲染器在 margin=1 时有"Invalid array length" bug，避开它；
      // margin=2 视觉上仍然紧凑，且扫码识别率更高
      margin: 2,
    });
  } catch {
    return '';
  }
}
