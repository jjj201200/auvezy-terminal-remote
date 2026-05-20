/**
 * shared/src/files.ts 类型契约测试
 *
 * 主要做编译期判别联合断言;运行期不验证逻辑(无逻辑)。
 */

import { describe, it, expectTypeOf } from 'vitest';
import type {
  FileEntry,
  FileListResponse,
  FileReadResponse,
  FileStatResponse,
  SearchNameMatch,
  SearchContentMatch,
  SearchEvent,
  SearchDone,
  FilePreviewKind,
} from './files.js';

describe('files types', () => {
  it('FilePreviewKind 是 text|image|none 联合', () => {
    expectTypeOf<FilePreviewKind>().toEqualTypeOf<'text' | 'image' | 'none'>();
  });

  it('FileEntry.kind 包含四类', () => {
    expectTypeOf<FileEntry['kind']>().toEqualTypeOf<'file' | 'dir' | 'symlink' | 'other'>();
  });

  it('SearchEvent 是 name 与 content 的判别联合', () => {
    const ev: SearchEvent = { kind: 'name', path: '/x', size: 0, mtimeMs: 0 };
    if (ev.kind === 'name') {
      expectTypeOf(ev).toMatchTypeOf<SearchNameMatch>();
    }
  });

  it('SearchContentMatch 含 line / matchStart / matchEnd', () => {
    const ev: SearchEvent = {
      kind: 'content', path: '/x', line: 1, preview: 'hi',
      matchStart: 0, matchEnd: 2,
    };
    if (ev.kind === 'content') {
      expectTypeOf(ev).toMatchTypeOf<SearchContentMatch>();
    }
  });

  it('FileListResponse.parent 允许 null', () => {
    expectTypeOf<FileListResponse['parent']>().toEqualTypeOf<string | null>();
  });

  it('FileReadResponse 含 truncated / lang', () => {
    expectTypeOf<FileReadResponse['truncated']>().toEqualTypeOf<boolean>();
    expectTypeOf<FileReadResponse['lang']>().toEqualTypeOf<string>();
  });

  it('FileStatResponse mime / previewable 可选', () => {
    expectTypeOf<FileStatResponse['mime']>().toEqualTypeOf<string | undefined>();
    expectTypeOf<FileStatResponse['previewable']>().toEqualTypeOf<FilePreviewKind | undefined>();
  });

  it('SearchDone 三个字段', () => {
    expectTypeOf<SearchDone>().toMatchTypeOf<{ truncated: boolean; scanned: number; elapsedMs: number }>();
  });
});
