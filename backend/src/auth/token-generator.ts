/**
 * Token / Session ID 生成器
 *
 * 用 Node 内置 randomBytes（CSPRNG，crypto-secure pseudorandom）生成
 * 32 字节随机数据后 hex 编码。32 字节 = 256 bit，对暴力穷举免疫。
 *
 * 生成的字符串长度 = 字节数 × 2（hex 编码每字节 2 字符），即 64 个 hex 字符。
 */

import { randomBytes } from 'node:crypto';
import { TOKEN_BYTES, SESSION_ID_BYTES } from '@auvezy/terminal-remote-shared';

/** 生成认证 Token（64 hex 字符） */
export function generateToken(): string {
  return randomBytes(TOKEN_BYTES).toString('hex');
}

/** 生成 Session ID（同规格 64 hex 字符） */
export function generateSessionId(): string {
  return randomBytes(SESSION_ID_BYTES).toString('hex');
}
