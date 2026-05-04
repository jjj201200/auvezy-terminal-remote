/**
 * 阶段 9 端到端 smoke：Web Push 订阅链路
 *
 * 验证：
 *  1. GET /api/push/vapid（公开端点）→ 拿到 publicKey（base64url，~87 chars）
 *  2. 未登录调 POST /api/push/subscriptions → 应被 auth 中间件挡掉（401）
 *  3. 用 token cookie 登录后 POST 一个伪 subscription → 应 200 OK
 *  4. GET 再次 → publicKey 应保持稳定（说明已写入 .claude-remote/vapid.json）
 *  5. DELETE /api/push/subscriptions → 应 200 + removed=true
 *
 * 不模拟真实浏览器订阅（VAPID 加密 + Web Push Protocol 太复杂）；
 * push-service.test.ts 已覆盖 notifyAll / 410 prune 等核心。
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';

const tmpHome = mkdtempSync(resolve(tmpdir(), 'ocr-stage9-'));
const PORT = 3193;
let pass = true;
const cliJs = resolve(import.meta.dirname, '..', 'dist', 'cli.js');

const child = spawn(
  process.execPath,
  [cliJs, '--port', String(PORT), '--no-terminal'],
  {
    env: {
      ...process.env,
      HOME: tmpHome,
      CLAUDE_COMMAND: 'bash',
      CLAUDE_ARGS: JSON.stringify(['-c', 'tail -f /dev/null', '--']),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  },
);

let stderr = '';
child.stderr.on('data', (d) => {
  stderr += d.toString();
});
let stdout = '';
child.stdout.on('data', (d) => {
  stdout += d.toString();
});

async function waitReady() {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/api/health`);
      if (r.ok) return true;
    } catch {
      /* */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

/** 把若干 32-byte 随机 buffer base64url 编码（构造伪 keys） */
function randomB64Url(n) {
  const buf = Buffer.alloc(n);
  for (let i = 0; i < n; i++) buf[i] = Math.floor(Math.random() * 256);
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

try {
  if (!(await waitReady())) {
    process.stdout.write('  ✗ backend 未就绪\n');
    process.stdout.write(`stderr:\n${stderr}\nstdout:\n${stdout}\n`);
    pass = false;
    throw new Error('not ready');
  }
  process.stdout.write('  ✓ backend ready\n');

  const cfgPath = resolve(tmpHome, '.claude-remote', 'config.json');
  const token = JSON.parse(readFileSync(cfgPath, 'utf-8')).token;

  // 通过 /api/auth 登录拿 cookie
  const loginRes = await fetch(`http://127.0.0.1:${PORT}/api/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  });
  const setCookie = loginRes.headers.get('set-cookie');
  if (!loginRes.ok || !setCookie) {
    process.stdout.write(`  ✗ /api/auth 登录失败: ${loginRes.status}\n`);
    pass = false;
    throw new Error('login failed');
  }
  const cookie = setCookie.split(';')[0];
  process.stdout.write(`  ✓ 登录获得 cookie ${cookie.split('=')[0]}\n`);

  // 1) 公开 vapid
  process.stdout.write('\n[smoke] 1) GET /api/push/vapid（公开）\n');
  const r1 = await fetch(`http://127.0.0.1:${PORT}/api/push/vapid`);
  const j1 = await r1.json();
  const pubKey1 = j1.publicKey;
  if (r1.ok && typeof pubKey1 === 'string' && pubKey1.length >= 80) {
    process.stdout.write(`  ✓ publicKey 长度 ${pubKey1.length}\n`);
  } else {
    process.stdout.write(`  ✗ vapid endpoint 异常: ${r1.status} ${JSON.stringify(j1)}\n`);
    pass = false;
  }

  // 2) 未登录订阅 → 401
  process.stdout.write('\n[smoke] 2) 未登录 POST /api/push/subscriptions → 应 401\n');
  const r2 = await fetch(`http://127.0.0.1:${PORT}/api/push/subscriptions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      endpoint: 'https://fake.example/p/abc',
      keys: { p256dh: randomB64Url(65), auth: randomB64Url(16) },
    }),
  });
  if (r2.status === 401) {
    process.stdout.write('  ✓ 401 unauthorized\n');
  } else {
    process.stdout.write(`  ✗ 期望 401 实际 ${r2.status}\n`);
    pass = false;
  }

  // 3) 已登录 POST → 200
  process.stdout.write('\n[smoke] 3) 已登录 POST → 应 200\n');
  const fakeEndpoint = `https://fcm.googleapis.com/fcm/send/${randomB64Url(20)}`;
  const r3 = await fetch(`http://127.0.0.1:${PORT}/api/push/subscriptions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({
      endpoint: fakeEndpoint,
      keys: { p256dh: randomB64Url(65), auth: randomB64Url(16) },
    }),
  });
  const j3 = await r3.json().catch(() => ({}));
  if (r3.ok && j3.ok === true) {
    process.stdout.write('  ✓ subscription 已注册\n');
  } else {
    process.stdout.write(`  ✗ POST 失败: ${r3.status} ${JSON.stringify(j3)}\n`);
    pass = false;
  }

  // 4) 再次 GET vapid → 公钥应稳定
  process.stdout.write('\n[smoke] 4) 二次 GET /api/push/vapid → publicKey 稳定\n');
  const r4 = await fetch(`http://127.0.0.1:${PORT}/api/push/vapid`);
  const j4 = await r4.json();
  if (j4.publicKey === pubKey1) {
    process.stdout.write('  ✓ publicKey 持久化稳定\n');
  } else {
    process.stdout.write(`  ✗ publicKey 变化\n`);
    pass = false;
  }

  // 5) DELETE
  process.stdout.write('\n[smoke] 5) DELETE → removed=true\n');
  const r5 = await fetch(`http://127.0.0.1:${PORT}/api/push/subscriptions`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({ endpoint: fakeEndpoint }),
  });
  const j5 = await r5.json().catch(() => ({}));
  if (r5.ok && j5.removed === true) {
    process.stdout.write('  ✓ removed=true\n');
  } else {
    process.stdout.write(`  ✗ DELETE 失败: ${r5.status} ${JSON.stringify(j5)}\n`);
    pass = false;
  }
} catch (err) {
  process.stdout.write(`异常：${err?.message ?? err}\n`);
  pass = false;
} finally {
  child.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 600));
  if (child.exitCode === null) child.kill('SIGKILL');
  rmSync(tmpHome, { recursive: true, force: true });
}

process.stdout.write('\n=== 总结 ===\n');
process.stdout.write(pass ? '✅ 阶段 9 全部通过\n' : '❌ 有失败项\n');
process.exit(pass ? 0 : 1);
