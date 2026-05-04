/**
 * atomic-write
 *
 * 写 tmp 文件 + rename，规避 partial write。
 * 同一 process 的多次写不会互相覆盖（tmp 名带 PID）。
 */

import { writeFileSync, renameSync } from 'node:fs';

/**
 * 原子写 JSON：先写 `<path>.tmp-<pid>`，再 rename 到目标路径。
 * 默认权限 0o600（私密文件）。
 *
 * @param path 目标路径
 * @param value 任何 JSON.stringify 可序列化的值
 * @param mode 文件权限，默认 0o600
 */
export function atomicWriteJson(path: string, value: unknown, mode = 0o600): void {
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify(value, null, 2), { encoding: 'utf-8', mode });
  renameSync(tmp, path);
}
