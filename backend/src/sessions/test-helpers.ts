/**
 * SessionsStore 测试 helper
 *
 * 仅供 *.test.ts 使用。production 代码请直接 `new SessionsStore({ ... })`。
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { SessionsStore } from './sessions-store.js';

/**
 * 创建临时 SessionsStore + 配套清理函数
 *
 * @example
 * const { store, cleanup } = createTmpSessionsStore(60_000);
 * try {
 *   const auth = new AuthModule({ ..., sessions: store });
 *   ...
 * } finally {
 *   cleanup();
 * }
 */
export function createTmpSessionsStore(sessionTtlMs: number): {
  store: SessionsStore;
  cleanup: () => void;
} {
  const baseDir = mkdtempSync(resolve(tmpdir(), 'atr-test-sessions-'));
  const store = new SessionsStore({
    path: resolve(baseDir, 'sessions.json'),
    lockDir: resolve(baseDir, '.lock'),
    sessionTtlMs,
  });
  return {
    store,
    cleanup: () => rmSync(baseDir, { recursive: true, force: true }),
  };
}
