/**
 * qrcode-banner：把可访问 URL 渲染成 ASCII 二维码字符串
 *
 * 设计：
 *  - qrcode-terminal 是 callback 风格 API，但回调在 generate 同步路径中
 *    立即被调用——所以包一层闭包就能用 sync 风格返回
 *  - 不直接写 stderr，让调用方决定输出位置（便于测试）
 *  - small=true 用半字符渲染，体积约一半，适合手机摄像头扫描
 *  - 错误时返回空字符串而不是抛错——banner 失败不应阻塞启动
 */

import qrcode from 'qrcode-terminal';

export interface QrCodeOptions {
  /** 用 small=true 半字符渲染（更紧凑） */
  small?: boolean;
}

/**
 * 把 URL 渲染为 ASCII 二维码字符串
 *
 * @returns 多行 ASCII，末尾通常含换行；失败时返回空字符串
 */
export function renderQrCode(url: string, opts: QrCodeOptions = {}): string {
  if (!url) return '';
  let out = '';
  try {
    qrcode.generate(url, { small: opts.small ?? true }, (s: string) => {
      out = s;
    });
  } catch {
    return '';
  }
  return out;
}
