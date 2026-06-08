/**
 * listDir:列目录一层。
 *
 * Why 并行 lstat:大目录(1k+ 条目)串行 await 单条 lstat 是 list 端最大开销;
 * readdir + Promise.all 让 libuv 线程池自然 fan-out,可在大目录上数量级地降延迟。
 *
 * Why 静默跳过单条失败:race / 权限错误一条不应该拖垮整个列表 — 返回 undefined
 * 让 filter 剔掉即可。
 *
 * Why 在数据源排序:列表顺序是契约的一部分,统一在此排好,前端 / 各消费方
 * 拿到即有序,不必各自再排(readdir 返回顺序由 OS 决定,不保证稳定)。
 * 排序规则:目录优先于其它(file/symlink/other),组内按 name 字节序升序 —
 * 字节序天然就是「符号 < 数字 < 字母」,且跨平台确定可复现(详见 obsidian
 * ADR-003:不用 localeCompare,避免不同机器 locale 解析不一致)。
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
  const entries = results.filter((e): e is FileEntry => e !== undefined);
  // 目录优先,组内字节序升序。compare 用 < / > 而非 localeCompare(ADR-003)。
  entries.sort((a, b) => {
    const aDir = a.kind === 'dir' ? 0 : 1;
    const bDir = b.kind === 'dir' ? 0 : 1;
    if (aDir !== bDir) return aDir - bDir;
    if (a.name < b.name) return -1;
    if (a.name > b.name) return 1;
    return 0;
  });
  return entries;
}
