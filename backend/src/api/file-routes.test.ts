/**
 * file-routes 单测
 *
 * 真实 Express server + AuthModule + 临时实例 registry。
 * 覆盖:鉴权、参数缺失、list/stat/read/raw/search 各路径正反例、deny 命中、
 * /raw header、限流。
 */

import { describe, it, expect, afterEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync, truncateSync, openSync, closeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import { AuthModule } from '../auth/auth-middleware.js';
import { createTmpSessionsStore } from '../sessions/test-helpers.js';
import type { InstanceRegistryManager } from '../registry/instance-registry.js';
import type { InstanceInfo } from 'auvezy-terminal-remote-shared';
import { createFileRoutes } from './file-routes.js';

const FAKE_INSTANCE_ID = 'inst-1';

interface Env {
  server: Server;
  port: number;
  cleanupSessions: () => void;
  auth: AuthModule;
  cleanupTmp: () => void;
  cwd: string;
  cwdReal: string;
}

interface MakeEnvOpts {
  /** 自定义 allow patterns(默认 []) */
  allow?: string[];
  /** 自定义 deny patterns(默认 []) */
  deny?: string[];
  /**
   * 自定义 cwd 路径。给了就直接用(不创建文件);
   * 不给则在 tmpdir 下生成 work 目录 + README.md + sub/。
   */
  cwd?: string;
}

/**
 * 启一个 express server 挂 file-routes,返回 env 句柄。
 * 不给 cwd 时自带 README.md + sub/ 两个 fixture;给了就 caller 自己负责
 * 准备文件。
 */
async function makeEnv(opts: MakeEnvOpts = {}): Promise<Env> {
  let cleanupTmp = (): void => {};
  let cwd: string;
  if (opts.cwd) {
    cwd = opts.cwd;
  } else {
    const tmpRoot = mkdtempSync(join(tmpdir(), 'fb-routes-'));
    cwd = join(tmpRoot, 'work');
    mkdirSync(cwd);
    mkdirSync(join(cwd, 'sub'));
    writeFileSync(join(cwd, 'README.md'), '# hi');
    cleanupTmp = () => rmSync(tmpRoot, { recursive: true, force: true });
  }
  const cwdReal = realpathSync(cwd);

  const app = express();
  app.use(express.json({ strict: false }));
  const { store: sessionsStore, cleanup } = createTmpSessionsStore(60_000);
  const auth = new AuthModule({
    token: 'a'.repeat(64),
    sessionTtlMs: 60_000,
    rateLimitPerMinute: 100,
    sessions: sessionsStore,
  });

  const registry = {
    async list(): Promise<InstanceInfo[]> {
      return [{
        instanceId: FAKE_INSTANCE_ID, name: 'fake',
        host: '127.0.0.1', port: 0, pid: process.pid,
        cwd: cwdReal, startedAt: new Date().toISOString(),
      }];
    },
  } as unknown as InstanceRegistryManager;

  app.use('/api', createFileRoutes({
    authModule: auth,
    registry,
    workdirPolicy: () => ({ allow: opts.allow ?? [], deny: opts.deny ?? [] }),
  }));
  app.post('/api/auth', auth.handleAuth);

  const server = createServer(app);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;

  return {
    server, port, cleanupSessions: cleanup, auth, cleanupTmp, cwd, cwdReal,
  };
}

async function teardown(env: Env): Promise<void> {
  env.auth.destroy();
  env.cleanupSessions();
  await new Promise<void>((r) => env.server.close(() => r()));
  env.cleanupTmp();
}

async function login(port: number): Promise<string> {
  const res = await fetch(`http://127.0.0.1:${port}/api/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: 'a'.repeat(64) }),
  });
  const sc = res.headers.get('set-cookie');
  if (!sc) throw new Error('no Set-Cookie');
  return sc.split(';')[0]!;
}

describe('file-routes', () => {
  let env: Env;

  afterEach(async () => { await teardown(env); });

  it('GET /api/files/list 未鉴权 → 401', async () => {
    env = await makeEnv();
    const res = await fetch(`http://127.0.0.1:${env.port}/api/files/list?instanceId=${FAKE_INSTANCE_ID}`);
    expect(res.status).toBe(401);
  });

  it('GET /api/files/list 缺 instanceId → 400 BAD_REQUEST', async () => {
    env = await makeEnv();
    const cookie = await login(env.port);
    const res = await fetch(`http://127.0.0.1:${env.port}/api/files/list`, { headers: { Cookie: cookie } });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('BAD_REQUEST');
  });

  it('GET /api/files/list 实例不存在 → 404 INSTANCE_NOT_FOUND', async () => {
    env = await makeEnv();
    const cookie = await login(env.port);
    const res = await fetch(`http://127.0.0.1:${env.port}/api/files/list?instanceId=missing`, { headers: { Cookie: cookie } });
    expect(res.status).toBe(404);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('INSTANCE_NOT_FOUND');
  });

  it('GET /api/files/list cwd 列出 README.md + sub', async () => {
    env = await makeEnv();
    const cookie = await login(env.port);
    const res = await fetch(`http://127.0.0.1:${env.port}/api/files/list?instanceId=${FAKE_INSTANCE_ID}`, { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    const body = await res.json() as { cwd: string; path: string; entries: Array<{ name: string }> };
    expect(body.cwd).toBe(env.cwdReal);
    expect(body.path).toBe(env.cwdReal);
    const names = body.entries.map((e) => e.name).sort();
    expect(names).toEqual(['README.md', 'sub']);
  });

  it('GET /api/files/read 文本文件返回内容', async () => {
    env = await makeEnv();
    const cookie = await login(env.port);
    const res = await fetch(`http://127.0.0.1:${env.port}/api/files/read?instanceId=${FAKE_INSTANCE_ID}&path=README.md`, { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    const body = await res.json() as { content: string; lang: string };
    expect(body.content).toBe('# hi');
    expect(body.lang).toBe('markdown');
  });

  it('GET /api/files/read deny 命中 → 403 PATH_FORBIDDEN', async () => {
    // 先创一个临时 cwd,再用同样的真路径作 deny pattern
    const tmpRoot = mkdtempSync(join(tmpdir(), 'fb-routes-deny-'));
    const cwd = join(tmpRoot, 'work');
    mkdirSync(cwd);
    writeFileSync(join(cwd, 'README.md'), '# hi');
    const cwdReal = realpathSync(cwd);
    env = await makeEnv({ cwd: cwdReal, deny: [`${cwdReal}/**`, cwdReal] });
    // makeEnv 在传入 cwd 时不会清理外层 tmpRoot,这里挂上
    const tearOrig = env.cleanupTmp;
    env.cleanupTmp = () => { tearOrig(); rmSync(tmpRoot, { recursive: true, force: true }); };

    const cookie = await login(env.port);
    const res = await fetch(`http://127.0.0.1:${env.port}/api/files/read?instanceId=${FAKE_INSTANCE_ID}&path=README.md`, { headers: { Cookie: cookie } });
    expect(res.status).toBe(403);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('PATH_FORBIDDEN');
  });

  it('GET /api/files/raw 不存在 → X-ATR-Error header(不返 JSON)', async () => {
    env = await makeEnv();
    const cookie = await login(env.port);
    const res = await fetch(`http://127.0.0.1:${env.port}/api/files/raw?instanceId=${FAKE_INSTANCE_ID}&path=nope.png`, { headers: { Cookie: cookie } });
    expect(res.status).toBe(404);
    expect(res.headers.get('x-atr-error')).toBe('PATH_NOT_FOUND');
    const text = await res.text();
    expect(text).toBe('');
  });

  // Range 系列:写一个 32 字节的 .bin 文件作 fixture,验证三种 Range 形式 + 边界
  it('GET /api/files/raw 不带 Range → 200 + 全量 + Accept-Ranges', async () => {
    env = await makeEnv();
    writeFileSync(join(env.cwd, 'bytes.bin'), Buffer.from('ABCDEFGHIJKLMNOPQRSTUVWXYZ012345'));
    const cookie = await login(env.port);
    const res = await fetch(`http://127.0.0.1:${env.port}/api/files/raw?instanceId=${FAKE_INSTANCE_ID}&path=bytes.bin`, { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    expect(res.headers.get('accept-ranges')).toBe('bytes');
    expect(res.headers.get('content-length')).toBe('32');
    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf.toString()).toBe('ABCDEFGHIJKLMNOPQRSTUVWXYZ012345');
  });

  it('GET /api/files/raw 带 Range bytes=0-9 → 206 + 前 10 字节', async () => {
    env = await makeEnv();
    writeFileSync(join(env.cwd, 'bytes.bin'), Buffer.from('ABCDEFGHIJKLMNOPQRSTUVWXYZ012345'));
    const cookie = await login(env.port);
    const res = await fetch(`http://127.0.0.1:${env.port}/api/files/raw?instanceId=${FAKE_INSTANCE_ID}&path=bytes.bin`, {
      headers: { Cookie: cookie, Range: 'bytes=0-9' },
    });
    expect(res.status).toBe(206);
    expect(res.headers.get('content-range')).toBe('bytes 0-9/32');
    expect(res.headers.get('content-length')).toBe('10');
    expect(Buffer.from(await res.arrayBuffer()).toString()).toBe('ABCDEFGHIJ');
  });

  it('GET /api/files/raw 带 Range bytes=10- → 206 + 从 10 到末尾', async () => {
    env = await makeEnv();
    writeFileSync(join(env.cwd, 'bytes.bin'), Buffer.from('ABCDEFGHIJKLMNOPQRSTUVWXYZ012345'));
    const cookie = await login(env.port);
    const res = await fetch(`http://127.0.0.1:${env.port}/api/files/raw?instanceId=${FAKE_INSTANCE_ID}&path=bytes.bin`, {
      headers: { Cookie: cookie, Range: 'bytes=10-' },
    });
    expect(res.status).toBe(206);
    expect(res.headers.get('content-range')).toBe('bytes 10-31/32');
    expect(res.headers.get('content-length')).toBe('22');
    expect(Buffer.from(await res.arrayBuffer()).toString()).toBe('KLMNOPQRSTUVWXYZ012345');
  });

  it('GET /api/files/raw 带 Range bytes=-5 → 206 + 末尾 5 字节', async () => {
    env = await makeEnv();
    writeFileSync(join(env.cwd, 'bytes.bin'), Buffer.from('ABCDEFGHIJKLMNOPQRSTUVWXYZ012345'));
    const cookie = await login(env.port);
    const res = await fetch(`http://127.0.0.1:${env.port}/api/files/raw?instanceId=${FAKE_INSTANCE_ID}&path=bytes.bin`, {
      headers: { Cookie: cookie, Range: 'bytes=-5' },
    });
    expect(res.status).toBe(206);
    expect(res.headers.get('content-range')).toBe('bytes 27-31/32');
    expect(res.headers.get('content-length')).toBe('5');
    expect(Buffer.from(await res.arrayBuffer()).toString()).toBe('12345');
  });

  it('GET /api/files/raw Range 末端越界 → 截到末尾(206)', async () => {
    env = await makeEnv();
    writeFileSync(join(env.cwd, 'bytes.bin'), Buffer.from('ABCDEFGHIJKLMNOPQRSTUVWXYZ012345'));
    const cookie = await login(env.port);
    const res = await fetch(`http://127.0.0.1:${env.port}/api/files/raw?instanceId=${FAKE_INSTANCE_ID}&path=bytes.bin`, {
      headers: { Cookie: cookie, Range: 'bytes=20-9999' },
    });
    expect(res.status).toBe(206);
    expect(res.headers.get('content-range')).toBe('bytes 20-31/32');
    expect(res.headers.get('content-length')).toBe('12');
  });

  it('GET /api/files/raw Range start 越界 → 416 + Content-Range: bytes */size', async () => {
    env = await makeEnv();
    writeFileSync(join(env.cwd, 'bytes.bin'), Buffer.from('ABCDEFGHIJKLMNOPQRSTUVWXYZ012345'));
    const cookie = await login(env.port);
    const res = await fetch(`http://127.0.0.1:${env.port}/api/files/raw?instanceId=${FAKE_INSTANCE_ID}&path=bytes.bin`, {
      headers: { Cookie: cookie, Range: 'bytes=100-200' },
    });
    expect(res.status).toBe(416);
    expect(res.headers.get('content-range')).toBe('bytes */32');
  });

  it('GET /api/files/raw Range 语法非法 → 416', async () => {
    env = await makeEnv();
    writeFileSync(join(env.cwd, 'bytes.bin'), Buffer.from('ABCDEFGHIJKLMNOPQRSTUVWXYZ012345'));
    const cookie = await login(env.port);
    const res = await fetch(`http://127.0.0.1:${env.port}/api/files/raw?instanceId=${FAKE_INSTANCE_ID}&path=bytes.bin`, {
      headers: { Cookie: cookie, Range: 'lines=0-10' },
    });
    expect(res.status).toBe(416);
  });

  // size 上限分流:video/audio 免检,image/binary 仍受限
  // 用 truncate 造稀疏文件:逻辑大小 200MB,实际 0 字节磁盘占用
  it('GET /api/files/raw 超 100MB 的 .mp4 → 200(video 免 size 上限)', async () => {
    env = await makeEnv();
    const huge = join(env.cwd, 'big.mp4');
    const fd = openSync(huge, 'w');
    closeSync(fd);
    truncateSync(huge, 200 * 1024 * 1024); // 200 MB 稀疏
    const cookie = await login(env.port);
    // 带 Range 拉前 10 字节,验证 Range 路径不被 size 上限拦截
    const res = await fetch(`http://127.0.0.1:${env.port}/api/files/raw?instanceId=${FAKE_INSTANCE_ID}&path=big.mp4`, {
      headers: { Cookie: cookie, Range: 'bytes=0-9' },
    });
    expect(res.status).toBe(206);
    expect(res.headers.get('content-range')).toBe(`bytes 0-9/${200 * 1024 * 1024}`);
    expect(res.headers.get('content-type')).toBe('video/mp4');
  });

  it('GET /api/files/raw 超 100MB 的 .mp3 → 200(audio 免 size 上限)', async () => {
    env = await makeEnv();
    const huge = join(env.cwd, 'big.mp3');
    const fd = openSync(huge, 'w');
    closeSync(fd);
    truncateSync(huge, 150 * 1024 * 1024);
    const cookie = await login(env.port);
    const res = await fetch(`http://127.0.0.1:${env.port}/api/files/raw?instanceId=${FAKE_INSTANCE_ID}&path=big.mp3`, {
      headers: { Cookie: cookie, Range: 'bytes=0-9' },
    });
    expect(res.status).toBe(206);
    expect(res.headers.get('content-type')).toBe('audio/mpeg');
  });

  it('GET /api/files/raw 超 100MB 的 .bin → 413 FILE_TOO_LARGE(非媒体仍受限)', async () => {
    env = await makeEnv();
    const huge = join(env.cwd, 'big.bin');
    const fd = openSync(huge, 'w');
    closeSync(fd);
    truncateSync(huge, 200 * 1024 * 1024);
    const cookie = await login(env.port);
    const res = await fetch(`http://127.0.0.1:${env.port}/api/files/raw?instanceId=${FAKE_INSTANCE_ID}&path=big.bin`, {
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(413);
    expect(res.headers.get('x-atr-error')).toBe('FILE_TOO_LARGE');
  });

  // ETag / 304 缓存
  it('GET /api/files/raw 响应带 weak ETag + Cache-Control: private', async () => {
    env = await makeEnv();
    writeFileSync(join(env.cwd, 'bytes.bin'), Buffer.from('ABCDEFGHIJKLMNOPQRSTUVWXYZ012345'));
    const cookie = await login(env.port);
    const res = await fetch(`http://127.0.0.1:${env.port}/api/files/raw?instanceId=${FAKE_INSTANCE_ID}&path=bytes.bin`, {
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('etag')).toMatch(/^W\/"\d+-\d+"$/);
    expect(res.headers.get('cache-control')).toMatch(/private/);
    expect(res.headers.get('cache-control')).toMatch(/max-age=\d+/);
  });

  it('GET /api/files/raw If-None-Match 命中 → 304(无 body)', async () => {
    env = await makeEnv();
    writeFileSync(join(env.cwd, 'bytes.bin'), Buffer.from('ABCDEFGHIJKLMNOPQRSTUVWXYZ012345'));
    const cookie = await login(env.port);
    // 先请求一次拿 ETag
    const first = await fetch(`http://127.0.0.1:${env.port}/api/files/raw?instanceId=${FAKE_INSTANCE_ID}&path=bytes.bin`, {
      headers: { Cookie: cookie },
    });
    await first.arrayBuffer();
    const etag = first.headers.get('etag')!;
    expect(etag).toBeTruthy();
    // 再请求带 If-None-Match
    const second = await fetch(`http://127.0.0.1:${env.port}/api/files/raw?instanceId=${FAKE_INSTANCE_ID}&path=bytes.bin`, {
      headers: { Cookie: cookie, 'If-None-Match': etag },
    });
    expect(second.status).toBe(304);
    const body = await second.arrayBuffer();
    expect(body.byteLength).toBe(0);
  });

  it('GET /api/files/raw If-None-Match: * → 304', async () => {
    env = await makeEnv();
    writeFileSync(join(env.cwd, 'bytes.bin'), Buffer.from('hello'));
    const cookie = await login(env.port);
    const res = await fetch(`http://127.0.0.1:${env.port}/api/files/raw?instanceId=${FAKE_INSTANCE_ID}&path=bytes.bin`, {
      headers: { Cookie: cookie, 'If-None-Match': '*' },
    });
    expect(res.status).toBe(304);
  });

  it('GET /api/files/raw If-None-Match 不匹配 → 200 + 全量', async () => {
    env = await makeEnv();
    writeFileSync(join(env.cwd, 'bytes.bin'), Buffer.from('hello'));
    const cookie = await login(env.port);
    const res = await fetch(`http://127.0.0.1:${env.port}/api/files/raw?instanceId=${FAKE_INSTANCE_ID}&path=bytes.bin`, {
      headers: { Cookie: cookie, 'If-None-Match': 'W/"999-1"' },
    });
    expect(res.status).toBe(200);
    expect((await res.text())).toBe('hello');
  });

  it('GET /api/files/raw If-None-Match 优先于 Range(304 抢先)', async () => {
    env = await makeEnv();
    writeFileSync(join(env.cwd, 'bytes.bin'), Buffer.from('ABCDEFGHIJKLMNOPQRSTUVWXYZ012345'));
    const cookie = await login(env.port);
    const first = await fetch(`http://127.0.0.1:${env.port}/api/files/raw?instanceId=${FAKE_INSTANCE_ID}&path=bytes.bin`, {
      headers: { Cookie: cookie },
    });
    await first.arrayBuffer();
    const etag = first.headers.get('etag')!;
    const second = await fetch(`http://127.0.0.1:${env.port}/api/files/raw?instanceId=${FAKE_INSTANCE_ID}&path=bytes.bin`, {
      headers: { Cookie: cookie, 'If-None-Match': etag, Range: 'bytes=0-9' },
    });
    expect(second.status).toBe(304);
  });

  it('GET /api/files/raw 超 100MB 的 .png → 413(image 仍受限)', async () => {
    env = await makeEnv();
    const huge = join(env.cwd, 'big.png');
    const fd = openSync(huge, 'w');
    closeSync(fd);
    truncateSync(huge, 200 * 1024 * 1024);
    const cookie = await login(env.port);
    const res = await fetch(`http://127.0.0.1:${env.port}/api/files/raw?instanceId=${FAKE_INSTANCE_ID}&path=big.png`, {
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(413);
    expect(res.headers.get('x-atr-error')).toBe('FILE_TOO_LARGE');
  });

  it('GET /api/files/stat 目录返回 kind=dir', async () => {
    env = await makeEnv();
    const cookie = await login(env.port);
    const res = await fetch(`http://127.0.0.1:${env.port}/api/files/stat?instanceId=${FAKE_INSTANCE_ID}&path=sub`, { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    const body = await res.json() as { kind: string };
    expect(body.kind).toBe('dir');
  });

  it('GET /api/files/search 鉴权后 q 缺失 → 400', async () => {
    env = await makeEnv();
    const cookie = await login(env.port);
    const res = await fetch(`http://127.0.0.1:${env.port}/api/files/search?instanceId=${FAKE_INSTANCE_ID}`, { headers: { Cookie: cookie } });
    expect(res.status).toBe(400);
  });

  it('GET /api/files/search name 模式命中流式返回', async () => {
    env = await makeEnv();
    const cookie = await login(env.port);
    const res = await fetch(`http://127.0.0.1:${env.port}/api/files/search?instanceId=${FAKE_INSTANCE_ID}&q=README&mode=name`, { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/event-stream/);
    const text = await res.text();
    expect(text).toContain('"kind":"name"');
    expect(text).toContain('README.md');
    expect(text).toContain('event: done');
  });

  it('GET /api/files/list 超阈值返 429 AUTH_RATE_LIMITED', async () => {
    // 阈值见 backend/src/constants.ts FILE_RATE_LIMIT_PER_MIN(0.8.0 起 600)
    // 这里硬连发 650 次,无论阈值后续怎么调,只要在合理范围内都能触发
    env = await makeEnv();
    const cookie = await login(env.port);
    let last = 0;
    let lastBody: { error?: { code: string } } | undefined;
    for (let i = 0; i < 650; i++) {
      const res = await fetch(`http://127.0.0.1:${env.port}/api/files/list?instanceId=${FAKE_INSTANCE_ID}`, { headers: { Cookie: cookie } });
      last = res.status;
      if (res.status === 429) {
        lastBody = await res.json() as { error: { code: string } };
        break;
      }
    }
    expect(last).toBe(429);
    expect(lastBody?.error?.code).toBe('AUTH_RATE_LIMITED');
  }, 60_000);
});
