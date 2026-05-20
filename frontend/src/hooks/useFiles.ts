/**
 * useFiles(instanceId)
 *
 * 暴露 list / read / stat,内部对 list 做 path 缓存(SWR-like)。
 * 切实例时整个 hook 重置(useMemo by instanceId)。
 */

import { useMemo, useRef, useCallback } from 'react';
import type {
  FileListResponse,
  FileReadResponse,
  FileStatResponse,
} from 'auvezy-terminal-remote-shared';
import { listFiles, readFile, statFile } from '../services/files-api.js';

export interface UseFiles {
  list(path?: string): Promise<FileListResponse>;
  read(path: string): Promise<FileReadResponse>;
  stat(path: string): Promise<FileStatResponse>;
  /** 直接读缓存,无网络;miss = undefined */
  cachedList(path: string): FileListResponse | undefined;
}

export function useFiles(instanceId: string | null): UseFiles {
  // 缓存放 ref(避免每次 setState 触发 re-render);
  // 切实例时由 useMemo 重新生成 ref 容器
  const cacheRef = useRef<Map<string, FileListResponse>>(new Map());

  useMemo(() => {
    cacheRef.current = new Map();
  }, [instanceId]);

  const list = useCallback(async (path?: string) => {
    if (!instanceId) throw new Error('no active instance');
    const r = await listFiles(instanceId, path);
    cacheRef.current.set(r.path, r);
    return r;
  }, [instanceId]);

  const read = useCallback(async (path: string) => {
    if (!instanceId) throw new Error('no active instance');
    return readFile(instanceId, path);
  }, [instanceId]);

  const stat = useCallback(async (path: string) => {
    if (!instanceId) throw new Error('no active instance');
    return statFile(instanceId, path);
  }, [instanceId]);

  const cachedList = useCallback((path: string) => cacheRef.current.get(path), []);

  return { list, read, stat, cachedList };
}
