/**
 * 前端工具:FileEntry → icon emoji + 字节数格式化。
 * 抽到 component 包内的小 helper,不引入新依赖。
 */

import type { FileEntry } from 'auvezy-terminal-remote-shared';

export function iconFor(e: FileEntry): string {
  if (e.kind === 'dir') return '📁';
  if (e.kind === 'symlink') return '🔗';
  if (e.previewable === 'image') return '🖼';
  if (e.previewable === 'text') return '📄';
  return '⬜';
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
