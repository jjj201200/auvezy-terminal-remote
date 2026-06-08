import type { JSX } from 'react';
import {
  IconFolder,
  IconLink,
  IconPhoto,
  IconFileText,
  IconFile,
  IconMovie,
  IconMusic,
} from '@tabler/icons-react';
import type { FileEntry } from 'auvezy-terminal-remote-shared';

const ICON_PROPS = { size: 16, stroke: 1.5 } as const;

export function iconFor(e: FileEntry): JSX.Element {
  if (e.kind === 'dir') return <IconFolder {...ICON_PROPS} />;
  if (e.kind === 'symlink') return <IconLink {...ICON_PROPS} />;
  if (e.previewable === 'image') return <IconPhoto {...ICON_PROPS} />;
  if (e.previewable === 'video') return <IconMovie {...ICON_PROPS} />;
  if (e.previewable === 'audio') return <IconMusic {...ICON_PROPS} />;
  if (e.previewable === 'text') return <IconFileText {...ICON_PROPS} />;
  return <IconFile {...ICON_PROPS} />;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** .md / .markdown(忽略大小写) — markdown 可视化路径分支判定 */
export function isMarkdownPath(path: string): boolean {
  const lower = path.toLowerCase();
  return lower.endsWith('.md') || lower.endsWith('.markdown');
}

/** .html / .htm / .xhtml(忽略大小写) — html 网页渲染路径分支判定 */
export function isHtmlPath(path: string): boolean {
  const lower = path.toLowerCase();
  return lower.endsWith('.html') || lower.endsWith('.htm') || lower.endsWith('.xhtml');
}
