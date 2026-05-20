/**
 * mime-detect:扩展名 → mime + previewable kind + lang
 *
 * 不读文件内容,仅基于路径。二进制识别在 read-file.ts 做(NUL 字节 + 替换字符)。
 *
 * 全名命中表(Makefile / Dockerfile 等)优先于扩展名映射。
 * SVG 同时是 text(XML) 与 image,本设计**优先按 image 渲染**(用户预期)。
 */

import { basename, extname } from 'node:path';
import type { FilePreviewKind } from 'auvezy-terminal-remote-shared';

/** 扩展名 → mime(text 类) */
const TEXT_EXT_TO_MIME: Record<string, string> = {
  '.md': 'text/markdown', '.markdown': 'text/markdown',
  '.txt': 'text/plain', '.log': 'text/plain',
  '.json': 'application/json', '.jsonc': 'application/json',
  '.yml': 'application/yaml', '.yaml': 'application/yaml',
  '.toml': 'application/toml',
  '.ini': 'text/plain', '.conf': 'text/plain', '.cfg': 'text/plain',
  '.env': 'text/plain', '.example': 'text/plain',
  '.gitignore': 'text/plain', '.dockerignore': 'text/plain',
  '.ts': 'text/typescript', '.tsx': 'text/tsx',
  '.js': 'text/javascript', '.jsx': 'text/jsx',
  '.mjs': 'text/javascript', '.cjs': 'text/javascript',
  '.py': 'text/x-python', '.go': 'text/x-go', '.rs': 'text/x-rust',
  '.rb': 'text/x-ruby', '.php': 'text/x-php',
  '.java': 'text/x-java', '.kt': 'text/x-kotlin', '.swift': 'text/x-swift',
  '.c': 'text/x-c', '.h': 'text/x-c',
  '.cc': 'text/x-c++', '.cpp': 'text/x-c++', '.hpp': 'text/x-c++',
  '.cs': 'text/x-csharp',
  '.sh': 'text/x-shellscript', '.bash': 'text/x-shellscript', '.zsh': 'text/x-shellscript',
  '.fish': 'text/x-shellscript', '.ps1': 'text/x-shellscript',
  '.html': 'text/html', '.htm': 'text/html',
  '.css': 'text/css', '.scss': 'text/x-scss',
  '.sass': 'text/x-sass', '.less': 'text/x-less',
  '.xml': 'application/xml', '.sql': 'application/sql',
  '.csv': 'text/csv', '.tsv': 'text/tab-separated-values',
  '.lock': 'text/plain', '.makefile': 'text/x-makefile',
};

/** 扩展名 → mime(image 类,优先匹配) */
const IMAGE_EXT_TO_MIME: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp', '.ico': 'image/x-icon', '.avif': 'image/avif',
};

/** 无扩展但全名为已知文本约定的文件 */
const BARE_NAME_TEXT = new Set([
  'Makefile', 'Dockerfile', 'Rakefile', 'Gemfile', 'Procfile',
]);

/** 扩展名 → Shiki lang short id;未命中由前端 lang-map 兜底为 'txt' */
const LANG_MAP: Record<string, string> = {
  '.ts': 'ts', '.tsx': 'tsx', '.js': 'js', '.jsx': 'jsx',
  '.mjs': 'js', '.cjs': 'js',
  '.md': 'markdown', '.markdown': 'markdown',
  '.yml': 'yaml', '.yaml': 'yaml',
  '.json': 'json', '.jsonc': 'json',
  '.toml': 'toml',
  '.py': 'python', '.go': 'go', '.rs': 'rust',
  '.rb': 'ruby', '.php': 'php',
  '.java': 'java', '.kt': 'kotlin', '.swift': 'swift',
  '.c': 'c', '.h': 'c',
  '.cc': 'cpp', '.cpp': 'cpp', '.hpp': 'cpp',
  '.cs': 'csharp',
  '.sh': 'shell', '.bash': 'shell', '.zsh': 'shell',
  '.html': 'html', '.htm': 'html',
  '.css': 'css', '.scss': 'scss', '.sass': 'sass', '.less': 'less',
  '.xml': 'xml', '.sql': 'sql',
  '.svg': 'xml',
};

export interface MimeInfo {
  mime: string;
  previewable: FilePreviewKind;
}

/**
 * 按文件名(或绝对路径)推断 mime + previewable。
 * 不接触文件内容,只看 basename + extname。
 */
export function detectMime(filename: string): MimeInfo {
  const base = basename(filename);
  const ext = extname(base).toLowerCase();

  // 全名命中(Makefile 等)
  if (BARE_NAME_TEXT.has(base)) {
    return { mime: 'text/plain', previewable: 'text' };
  }

  // 图片优先(svg 走 image 渲染)
  if (ext in IMAGE_EXT_TO_MIME) {
    return { mime: IMAGE_EXT_TO_MIME[ext]!, previewable: 'image' };
  }
  if (ext in TEXT_EXT_TO_MIME) {
    return { mime: TEXT_EXT_TO_MIME[ext]!, previewable: 'text' };
  }
  return { mime: 'application/octet-stream', previewable: 'none' };
}

/**
 * 按文件名推断 Shiki lang short id;未识别 → 'txt'(前端走 escapeHtml 降级)。
 */
export function detectLang(filename: string): string {
  const ext = extname(filename).toLowerCase();
  return LANG_MAP[ext] ?? 'txt';
}
