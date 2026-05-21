/**
 * readTextFile:读文本文件,带大小截断 + 字节级/字符级二进制识别
 *
 * 严格顺序(design §5.4):
 *  1. open + 读前 4 KiB:命中 0x00 → FILE_BINARY
 *  2. 全文读(最多 FILE_READ_MAX_BYTES,超量截断)
 *  3. 解码后检查 U+FFFD(replacement char)密度,>5% → FILE_BINARY
 *
 * 注:截断按"字节边界"截到 FILE_READ_MAX_BYTES,UTF-8 多字节字符可能被切半。
 * 切半的多字节序列在 toString('utf-8') 解码时变成 U+FFFD,密度极低不影响判定。
 */

import { open, stat } from 'node:fs/promises';
import { ErrorCode, FILE_READ_MAX_BYTES } from 'auvezy-terminal-remote-shared';
import { FileError } from '../errors.js';

export interface ReadResult {
  /** UTF-8 文本内容 */
  content: string;
  /** 是否被截断 */
  truncated: boolean;
  /** 原始字节数(未截断前) */
  size: number;
  /** 前 4 KiB 含 ANSI ESC CSI 序列(用于 lang 推断走 'ansi' 分支) */
  hasAnsi: boolean;
}

const NUL_PROBE_BYTES = 4 * 1024;
const REPLACEMENT_CHAR = '�';
const REPLACEMENT_DENSITY_LIMIT = 0.05;

/**
 * 字节序列里查 ESC '[' 对(0x1B 0x5B):ANSI CSI 引导符。
 * 单独 0x1B 在非 ANSI 文本里(如二进制 metadata 残留)也可能出现,要求紧接 '['
 * 才认定为 ANSI。
 */
function probeHasAnsi(buf: Buffer): boolean {
  for (let i = 0; i < buf.length - 1; i++) {
    if (buf[i] === 0x1b && buf[i + 1] === 0x5b) return true;
  }
  return false;
}

/**
 * 读单个文本文件。
 *
 * @param absPath 绝对路径(由 resolveSafePath 已校验过)
 * @throws FileError(FILE_BINARY) 字节级或字符级判定为二进制
 */
export async function readTextFile(absPath: string): Promise<ReadResult> {
  const st = await stat(absPath);
  const size = st.size;

  const fh = await open(absPath, 'r');
  try {
    // Step 1: 字节级 NUL 闸(解码前)+ 顺便 ANSI 探测
    const probeLen = Math.min(NUL_PROBE_BYTES, size);
    let hasAnsi = false;
    if (probeLen > 0) {
      const probe = Buffer.alloc(probeLen);
      await fh.read(probe, 0, probeLen, 0);
      if (probe.includes(0x00)) {
        throw new FileError(
          ErrorCode.FILE_BINARY,
          'file contains NUL bytes (binary)',
          409,
        );
      }
      hasAnsi = probeHasAnsi(probe);
    }

    // Step 2: 全文读(截断)
    const readLen = Math.min(size, FILE_READ_MAX_BYTES);
    const buf = Buffer.alloc(readLen);
    if (readLen > 0) {
      await fh.read(buf, 0, readLen, 0);
    }
    const content = buf.toString('utf-8');
    const truncated = size > FILE_READ_MAX_BYTES;

    // Step 3: 字符级 replacement char 密度闸(解码后)
    if (content.length > 0) {
      let replacements = 0;
      for (const ch of content) {
        if (ch === REPLACEMENT_CHAR) replacements++;
      }
      const density = replacements / content.length;
      if (density > REPLACEMENT_DENSITY_LIMIT) {
        throw new FileError(
          ErrorCode.FILE_BINARY,
          `non-UTF8 content (replacement density ${(density * 100).toFixed(1)}%)`,
          409,
        );
      }
    }

    return { content, truncated, size, hasAnsi };
  } finally {
    await fh.close();
  }
}
