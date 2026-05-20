/**
 * 文件浏览协议类型(前后端共享)
 *
 * 与 docs/plans/file-browser/design.md §4.1 对齐。
 * 所有路径字段均为绝对路径。
 */

/** 文件可预览类型 */
export type FilePreviewKind = 'text' | 'image' | 'none';

/** 列表条目 */
export interface FileEntry {
  /** 仅 basename,不含路径 */
  name: string;
  kind: 'file' | 'dir' | 'symlink' | 'other';
  /** 字节数;dir 固定 0 */
  size: number;
  mtimeMs: number;
  /** name 以 . 开头 */
  hidden: boolean;
  /** 仅 file 有 */
  mime?: string;
  previewable?: FilePreviewKind;
}

/** GET /api/files/list 响应 */
export interface FileListResponse {
  ok: true;
  /** 实例 cwd 绝对路径 */
  cwd: string;
  /** 当前展示路径绝对路径 */
  path: string;
  /** 上级目录绝对路径;null 表示越界已到 workdir-policy 边界 */
  parent: string | null;
  entries: FileEntry[];
}

/** GET /api/files/read 响应 */
export interface FileReadResponse {
  ok: true;
  path: string;
  mime: string;
  /** UTF-8 文本;二进制走 /raw */
  content: string;
  /** content 是否被截断到 FILE_READ_MAX_BYTES */
  truncated: boolean;
  /** 字节数(原始,非 content.length) */
  size: number;
  /** 后端推断的 lang(unknown → 'txt') */
  lang: string;
}

/** GET /api/files/stat 响应 */
export interface FileStatResponse {
  ok: true;
  path: string;
  kind: 'file' | 'dir' | 'symlink' | 'other';
  size: number;
  mtimeMs: number;
  mime?: string;
  previewable?: FilePreviewKind;
}

// ──────────────── 搜索 SSE 事件 ────────────────

export interface SearchNameMatch {
  kind: 'name';
  path: string;
  size: number;
  mtimeMs: number;
}

export interface SearchContentMatch {
  kind: 'content';
  path: string;
  /** 1-based */
  line: number;
  /** 单行裁到 PREVIEW_MAX_CHARS */
  preview: string;
  /** preview 内的高亮区间 */
  matchStart: number;
  matchEnd: number;
}

export type SearchEvent = SearchNameMatch | SearchContentMatch;

/** SSE done 事件 payload */
export interface SearchDone {
  truncated: boolean;
  scanned: number;
  elapsedMs: number;
}

// ──────────────── 常量(前后端共享) ────────────────

/** /read 单文件最大读取字节数(超出截断) */
export const FILE_READ_MAX_BYTES = 2 * 1024 * 1024;

/** /raw 单文件最大字节数(超出拒绝) */
export const FILE_RAW_MAX_BYTES = 8 * 1024 * 1024;

/** 搜索关键字最大长度 */
export const SEARCH_MAX_Q_LENGTH = 200;

/** 文件名搜索结果上限 */
export const SEARCH_MAX_NAME_RESULTS = 100;

/** 内容搜索结果上限 */
export const SEARCH_MAX_CONTENT_RESULTS = 200;

/** 搜索单文件硬超时 */
export const SEARCH_FILE_TIMEOUT_MS = 100;

/** 搜索全请求总超时 */
export const SEARCH_TOTAL_TIMEOUT_MS = 5000;

/** 搜索并发文件数 */
export const SEARCH_CONCURRENCY = 8;
