/**
 * hook-routes 单测
 *
 * 用真实 Express server + supertest-like 风格（fetch 直接打）验证：
 * - loopback 准入
 * - 非 loopback 拒绝（用伪造 X-Forwarded-For 模拟）
 * - 非法 payload 400
 * - 合法 payload 200 + ignored / notification 路径
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { HookReceiver } from '../hooks/hook-receiver.js';
import { createHookRoutes } from './hook-routes.js';

describe('hook-routes', () => {
  let server: Server;
  let port: number;
  let receiver: HookReceiver;

  beforeEach(async () => {
    const app = express();
    app.use(express.json({ strict: false }));
    receiver = new HookReceiver();
    app.use('/api', createHookRoutes(receiver));
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('loopback + permission_prompt → 200 含 tool', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/hook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        notification_type: 'permission_prompt',
        tool_name: 'Bash',
        message: 'foo',
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; tool?: string };
    expect(body.ok).toBe(true);
    expect(body.tool).toBe('Bash');
  });

  it('loopback + PreToolUse → 200 ignored', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/hook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; ignored?: boolean };
    expect(body.ignored).toBe(true);
  });

  it('非法 payload（非对象）→ 400', async () => {
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
    // 直接通过 supertest-style：手工构造一个伪造来源 IP 的 req
    // 用 Express 的 trust proxy + X-Forwarded-For 注入
    // 这里用单独的 app 实例
    const app = express();
    app.set('trust proxy', true); // 信任 X-Forwarded-For
    app.use(express.json({ strict: false }));
    const r = new HookReceiver();
    app.use('/api', createHookRoutes(r));
    const srv = createServer(app);
    await new Promise<void>((res) => srv.listen(0, '127.0.0.1', res));
    const p = (srv.address() as AddressInfo).port;

    const res = await fetch(`http://127.0.0.1:${p}/api/hook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-For': '192.168.1.50',
      },
      body: JSON.stringify({ notification_type: 'permission_prompt', tool_name: 'Bash' }),
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('HOOK_NON_LOCALHOST');

    await new Promise<void>((res) => srv.close(() => res()));
  });
});
