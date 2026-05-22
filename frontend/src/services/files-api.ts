/**
 * /api/files/* 客户端封装
 *
 * 所有调用走**绝对路径 `/api/files/*`** —— 0.7.0 v2 起 file-routes 是 broker
 * 系统级 API,挂在 broker 根 `/api/` 下而非 instance scope。如果用相对路径
 * `api/files/...`,浏览器在 `/i/<id>/` 当前路径下会解析为 `/i/<id>/api/files/...`,
 * 被 instance-router 反代到 worker 而 worker 不接 file-routes → 404。
 *
 * 绝对路径在生产 base href 注入下也对(`<base href="/i/<id>/">` 不影响绝对路径)。
 *
 * 错误统一抛 Error & { code: string },code 取自后端 ErrorPayload.code。
 */

import type {
  FileListResponse,
  FileReadResponse,
  FileStatResponse,
  SearchEvent,
  SearchDone,
  SearchMode,
} from 'auvezy-terminal-remote-shared';

export async function listFiles(instanceId: string, path?: string): Promise<FileListResponse> {
  const q = new URLSearchParams({ instanceId });
  if (path) q.set('path', path);
  const r = await fetch(`/api/files/list?${q.toString()}`, { credentials: 'include' });
  if (!r.ok) throw await asError(r);
  return r.json();
}

export async function readFile(instanceId: string, path: string): Promise<FileReadResponse> {
  const q = new URLSearchParams({ instanceId, path });
  const r = await fetch(`/api/files/read?${q.toString()}`, { credentials: 'include' });
  if (!r.ok) throw await asError(r);
  return r.json();
}

export async function statFile(instanceId: string, path: string): Promise<FileStatResponse> {
  const q = new URLSearchParams({ instanceId, path });
  const r = await fetch(`/api/files/stat?${q.toString()}`, { credentials: 'include' });
  if (!r.ok) throw await asError(r);
  return r.json();
}

/** 拼 raw URL,前端给 <img src> 用 */
export function rawUrl(instanceId: string, path: string): string {
  const q = new URLSearchParams({ instanceId, path });
  return `/api/files/raw?${q.toString()}`;
}

export interface SearchHandle {
  cancel(): void;
}

export interface SearchParams {
  q: string;
  mode: SearchMode;
  scope?: string;
  caseSensitive?: boolean;
  regex?: boolean;
}

/**
 * 启动一次 SSE 搜索流。
 *
 * @returns SearchHandle.cancel() 主动关闭 EventSource。
 */
export function streamSearch(
  instanceId: string,
  params: SearchParams,
  onMatch: (m: SearchEvent) => void,
  onDone: (d: SearchDone) => void,
  onError: (code: string) => void,
): SearchHandle {
  const sp = new URLSearchParams({
    instanceId,
    q: params.q,
    mode: params.mode,
    caseSensitive: params.caseSensitive ? '1' : '0',
    regex: params.regex ? '1' : '0',
  });
  if (params.scope) sp.set('scope', params.scope);

  const es = new EventSource(`/api/files/search?${sp.toString()}`, { withCredentials: true });
  es.addEventListener('match', (ev) => {
    try { onMatch(JSON.parse((ev as MessageEvent).data) as SearchEvent); }
    catch { /* 单条解析失败不致命 */ }
  });
  es.addEventListener('done', (ev) => {
    try { onDone(JSON.parse((ev as MessageEvent).data) as SearchDone); }
    catch { /* ignore */ }
    es.close();
  });
  es.addEventListener('error', () => {
    onError('STREAM_ERROR');
    es.close();
  });

  return { cancel: () => es.close() };
}

async function asError(r: Response): Promise<Error & { code: string }> {
  try {
    const body = await r.json() as { error?: { code?: string; message?: string } };
    const code = body?.error?.code ?? `HTTP_${r.status}`;
    const err = new Error(body?.error?.message ?? `request failed: ${r.status}`) as Error & { code: string };
    err.code = code;
    return err;
  } catch {
    const err = new Error(`request failed: ${r.status}`) as Error & { code: string };
    err.code = `HTTP_${r.status}`;
    return err;
  }
}
