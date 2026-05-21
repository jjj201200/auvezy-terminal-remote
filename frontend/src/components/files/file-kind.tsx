/**
 * 前端工具:FileEntry → tabler icon node + 字节数格式化。
 *
 * 为什么从 .ts 改 .tsx:iconFor 现在返 JSX 节点(`@tabler/icons-react` 组件),
 * 比 emoji 与项目其它顶栏图标视觉一致。
 */

import type { JSX } from 'react';
import {
  IconFolder,
  IconLink,
  IconPhoto,
  IconFileText,
  IconFile,
} from '@tabler/icons-react';
import type { FileEntry } from 'auvezy-terminal-remote-shared';

const ICON_PROPS = { size: 16, stroke: 1.5 } as const;

export function iconFor(e: FileEntry): JSX.Element {
  if (e.kind === 'dir') return <IconFolder {...ICON_PROPS} />;
  if (e.kind === 'symlink') return <IconLink {...ICON_PROPS} />;
  if (e.previewable === 'image') return <IconPhoto {...ICON_PROPS} />;
  if (e.previewable === 'text') return <IconFileText {...ICON_PROPS} />;
  return <IconFile {...ICON_PROPS} />;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
