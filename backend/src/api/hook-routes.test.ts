/**
 * hook-routes 单测
 *
 * 用真实 Express server + fetch 验证:
 * - loopback 准入
 * - 非 loopback 拒绝(伪造 X-Forwarded-For 模拟)
 * - 非法 payload 400
 * - manager 未激活时 → 200 ignored;激活时 → 200 ok
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { IntegrationManager } from '../integrations/manager.js';
import { ClaudeCodeIntegration } from '../integrations/claude-code/index.js';
import { createHookRoutes } from './hook-routes.js';

/** 启一个临时 Express + 路由,返回 port + cleanup */
async function bootstrapServer(opts: {
  manager: IntegrationManager;
  trustProxy?: boolean;
}): Promise<{ port: number; close: () => Promise<void> }> {
  const app = express();
  if (opts.trustProxy) app.set('trust proxy', true);
  app.use(express.json({ strict: false }));
  app.use('/api', createHookRoutes(opts.manager));
  const server: Server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    port,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

describe('hook-routes', () => {
  let port: number;
  let close: () => Promise<void>;
  let mgr: IntegrationManager;

  beforeEach(async () => {
    mgr = new IntegrationManager();
    mgr.register(new ClaudeCodeIntegration({ settingsBaseDir: '/tmp/atr-test-hook-routes' }));
    // 走 prepareSpawn 让模块激活(给 detect 一个能命中的 command)
    mgr.prepareSpawn({ command: 'claude', args: [], port: 9999 });
    ({ port, close } = await bootstrapServer({ manager: mgr }));
  });

  afterEach(async () => {
    await close();
    mgr.shutdown();
  });

  it('loopback + permission_prompt → 200 ok', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/hook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        hook_event_name: 'Notification',
        notification_type: 'permission_prompt',
        tool_name: 'Bash',
        message: 'foo',
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; ignored?: string };
    expect(body.ok).toBe(true);
    expect(body.ignored).toBeUndefined();
  });

  it('未激活 manager → 200 ignored=no_active_integration', async () => {
    await close();
    mgr.shutdown();
    mgr = new IntegrationManager({ enabled: false, forceModule: 'auto', perModule: {} });
    ({ port, close } = await bootstrapServer({ manager: mgr }));
    const res = await fetch(`http://127.0.0.1:${port}/api/hook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; ignored?: string };
    expect(body.ignored).toBe('no_active_integration');
  });

  it('非法 payload(非对象) → 400', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/hook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify('not-an-object'),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('HOOK_INVALID_PAYLOAD');
  });

  it('非 loopback IP 应被 403 拒绝', async () => {
    await close();
    const fresh = new IntegrationManager();
    fresh.register(new ClaudeCodeIntegration({ settingsBaseDir: '/tmp/atr-test-hook-routes' }));
    fresh.prepareSpawn({ command: 'claude', args: [], port: 9999 });
    const srv = await bootstrapServer({ manager: fresh, trustProxy: true });
    const res = await fetch(`http://127.0.0.1:${srv.port}/api/hook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-For': '192.168.1.50',
      },
      body: JSON.stringify({
        hook_event_name: 'Notification',
        notification_type: 'permission_prompt',
      }),
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('HOOK_NON_LOCALHOST');
    await srv.close();
    fresh.shutdown();
  });
});
