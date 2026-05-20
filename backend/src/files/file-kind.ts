/**
 * 从 fs.Stats 推断 FileEntry.kind(symlink / dir / file / other)。
 *
 * 抽出来是因为 list-dir / file-routes(stat 端点)都要这套判断,
 * 三层三元嵌套不利于阅读。
 */

import type { Stats } from 'node:fs';
import type { FileEntry } from 'auvezy-terminal-remote-shared';

export function getFileKind(stat: Stats): FileEntry['kind'] {
  if (stat.isSymbolicLink()) return 'symlink';
  if (stat.isDirectory()) return 'dir';
  if (stat.isFile()) return 'file';
  return 'other';
}
