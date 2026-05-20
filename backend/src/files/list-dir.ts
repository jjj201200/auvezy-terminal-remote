/**
 * listDir:列目录一层
 *
 * 使用 fs.opendir 异步迭代,对每个 entry 做 lstat 拿 size / mtime / kind。
 * 不递归。不读文件内容。
 *
 * 设计取舍:
 *  - socket/fifo/device 被映射为 kind='other',由路由层决定要不要在响应里隐藏
 *    (MVP 保留显示,但不可预览/读取);
 *  - 单条 lstat 失败(权限/race)→ 静默跳过,不让单个失败拖垮整个 list。
 */

import { opendir, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import type { FileEntry } from 'auvezy-terminal-remote-shared';
import { detectMime } from './mime-detect.js';

export async function listDir(dirPath: string): Promise<FileEntry[]> {
  const entries: FileEntry[] = [];
  const dir = await opendir(dirPath);

  for await (const dirent of dir) {
    const fullPath = join(dirPath, dirent.name);
    let stat;
    try {
      stat = await lstat(fullPath);
    } catch {
      // stat 失败(权限/race condition)→ 跳过该条目
      continue;
    }

    const kind: FileEntry['kind'] = stat.isSymbolicLink()
      ? 'symlink'
      : stat.isDirectory()
        ? 'dir'
        : stat.isFile()
          ? 'file'
          : 'other';

    const entry: FileEntry = {
      name: dirent.name,
      kind,
      size: kind === 'dir' ? 0 : stat.size,
      mtimeMs: stat.mtimeMs,
      hidden: dirent.name.startsWith('.'),
    };

    if (kind === 'file') {
      const { mime, previewable } = detectMime(dirent.name);
      entry.mime = mime;
      entry.previewable = previewable;
    }

    entries.push(entry);
  }

  return entries;
}
