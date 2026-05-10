/**
 * qrcode-banner：把 URL 渲染为终端 ASCII 二维码（异步、紧凑模式）
 *
 * 设计：
 *  - 用 qrcode 库的 'utf8' 输出格式
 *    （比 qrcode-terminal 更紧凑：utf8 走 ▀ ▄ █ 半字符 + 错误纠错可调）
 *  - errorCorrectionLevel 默认 'M'（15%）：实测用手机拍 LCD/OLED 屏时,'L'（7%）
 *    在反光、摩尔纹、轻微倾斜场景下识别率低;'M' 在二维码尺寸只比 L 大约 15%
 *    的代价下大幅提升容错。'H'（30%）会显著变大,小终端窗口可能放不下,所以
 *    不作默认。用户可显式传 'H' 用于"必须 robust"的场景。
 *  - 失败时返回空字符串，不阻塞启动
 */

import QRCode from 'qrcode';

export interface QrCodeOptions {
  /** 错误纠错级别：L=7% / M=15% / Q=25% / H=30%，默认 M（屏幕拍照容错） */
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
      errorCorrectionLevel: opts.errorCorrectionLevel ?? 'M',
      // utf8 模式本身就是半字符垂直压缩，体积约 qrcode-terminal small=true 的 1/2。
      // margin: utf8 渲染器在 margin=1 时有"Invalid array length" bug，避开它；
      // margin=2 视觉上仍然紧凑，且扫码识别率更高
      margin: 2,
    });
  } catch {
    return '';
  }
}
