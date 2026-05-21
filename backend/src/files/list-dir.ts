/**
 * listDir:列目录一层。
 *
 * Why 并行 lstat:大目录(1k+ 条目)串行 await 单条 lstat 是 list 端最大开销;
 * readdir + Promise.all 让 libuv 线程池自然 fan-out,可在大目录上数量级地降延迟。
 *
 * Why 静默跳过单条失败:race / 权限错误一条不应该拖垮整个列表 — 返回 undefined
 * 让 filter 剔掉即可。
 */

import { readdir, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import type { FileEntry } from 'auvezy-terminal-remote-shared';
import { detectMime } from './mime-detect.js';
import { getFileKind } from './file-kind.js';

export async function listDir(dirPath: string): Promise<FileEntry[]> {
  const dirents = await readdir(dirPath, { withFileTypes: true });
  const results = await Promise.all(
    dirents.map((dirent): Promise<FileEntry | undefined> =>
      lstat(join(dirPath, dirent.name)).then(
        (stat) => {
          const kind = getFileKind(stat);
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
          return entry;
        },
        () => undefined,
      ),
    ),
  );
  return results.filter((e): e is FileEntry => e !== undefined);
}
