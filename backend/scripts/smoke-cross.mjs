/**
 * 跨阶段集成 smoke：核心 happy path
 *
 * 1. 启动 backend（隔离 HOME）
 * 2. /api/health → 200
 * 3. /api/auth 登录 → set-cookie
 * 4. WS 连入 → 收 history_sync
 * 5. WS 发 user_input → 通过 PTY 回显（bash echo）
 * 6. /api/config 改 shortcuts → /api/config 读回校验
 * 7. /api/instances → 至少看到当前实例
 * 8. /api/push/vapid → 公开 publicKey
 * 9. SIGTERM 子进程 → 清理 HOME
 *
 * 任何一步失败整体 fail；端口、HOME 必清。
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import WebSocket from 'ws';

const tmpHome = mkdtempSync(resolve(tmpdir(), 'ocr-cross-'));
const PORT = 3194;
let pass = true;
const cliJs = resolve(import.meta.dirname, '..', 'dist', 'cli.js');

// bash 持续运行，避免 PTY 退出关掉会话；启动时 echo 一行作为 history 标记
const bashScript = `echo READY-MARKER; exec bash -i`;

const child = spawn(
  process.execPath,
  [cliJs, '--port', String(PORT), '--no-terminal'],
  {
    env: {
      ...process.env,
      HOME: tmpHome,
      CLAUDE_COMMAND: 'bash',
      CLAUDE_ARGS: JSON.stringify(['-c', bashScript, '--']),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  },
);

let stderr = '';
child.stderr.on('data', (d) => {
  stderr += d.toString();
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

function check(label, ok, detail = '') {
  process.stdout.write(`  ${ok ? '✓' : '✗'} ${label}${detail ? ' — ' + detail : ''}\n`);
  if (!ok) pass = false;
}

try {
  if (!(await waitReady())) {
    process.stdout.write('  ✗ backend 未就绪\n');
    process.stdout.write(`stderr:\n${stderr}\n`);
    pass = false;
    throw new Error('not ready');
  }
  process.stdout.write('[smoke] backend ready\n');

  const cfgPath = resolve(tmpHome, '.claude-remote', 'config.json');
  const token = JSON.parse(readFileSync(cfgPath, 'utf-8')).token;

  // 3) 登录
  process.stdout.write('\n[1] /api/auth 登录\n');
  const loginRes = await fetch(`http://127.0.0.1:${PORT}/api/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  });
  const setCookie = loginRes.headers.get('set-cookie');
  const cookie = setCookie?.split(';')[0] ?? '';
  check('200 + set-cookie', loginRes.ok && cookie.startsWith('session_id_p'));

  // 4) WS history_sync
  process.stdout.write('\n[2] WS history_sync 含 READY-MARKER\n');
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws?token=${encodeURIComponent(token)}`);
  const hist = await new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('history timeout')), 5000);
    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'history_sync') {
          clearTimeout(t);
          res(msg);
        }
      } catch {
        /* */
      }
    });
    ws.once('error', rej);
  });
  check('history_sync 含 READY-MARKER', typeof hist.data === 'string' && hist.data.includes('READY-MARKER'));

  // 5) user_input 回显
  process.stdout.write('\n[3] WS user_input → echo 回显\n');
  const echoSeen = new Promise((res) => {
    const t = setTimeout(() => res(false), 3000);
    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'terminal_output' && typeof msg.data === 'string' && msg.data.includes('SMOKE-ECHO-12345')) {
          clearTimeout(t);
          res(true);
        }
      } catch {
        /* */
      }
    });
  });
  ws.send(JSON.stringify({ type: 'user_input', data: 'echo SMOKE-ECHO-12345\r' }));
  check('PTY 回显', await echoSeen);
  ws.close();

  // 6) /api/config 读写
  process.stdout.write('\n[4] /api/config 改写 + 读回\n');
  const cfgGet = await fetch(`http://127.0.0.1:${PORT}/api/config`, {
    headers: { cookie },
  });
  const cfgGetBody = await cfgGet.json();
  check('GET /api/config', cfgGet.ok && Array.isArray(cfgGetBody.config?.shortcuts));

  const newShortcuts = [{ label: 'X', data: 'x' }];
  const cfgPut = await fetch(`http://127.0.0.1:${PORT}/api/config`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({ ...cfgGetBody.config, shortcuts: newShortcuts }),
  });
  check('PUT /api/config', cfgPut.ok);

  const cfgGet2 = await fetch(`http://127.0.0.1:${PORT}/api/config`, {
    headers: { cookie },
  });
  const cfgGet2Body = await cfgGet2.json();
  check(
    '读回 shortcuts 已更新',
    cfgGet2Body.config?.shortcuts?.length === 1 && cfgGet2Body.config.shortcuts[0].label === 'X',
  );

  // 7) /api/instances
  process.stdout.write('\n[5] /api/instances 至少 1 项\n');
  const inst = await fetch(`http://127.0.0.1:${PORT}/api/instances`, {
    headers: { cookie },
  });
  const instBody = await inst.json();
  check('instances 列表非空', inst.ok && Array.isArray(instBody.instances) && instBody.instances.length >= 1);

  // 8) /api/push/vapid
  process.stdout.write('\n[6] /api/push/vapid 公开\n');
  const vapid = await fetch(`http://127.0.0.1:${PORT}/api/push/vapid`);
  const vapidBody = await vapid.json();
  check('publicKey 长度 >= 80', vapid.ok && typeof vapidBody.publicKey === 'string' && vapidBody.publicKey.length >= 80);
} catch (err) {
  process.stdout.write(`异常：${err?.message ?? err}\n`);
  pass = false;
} finally {
  child.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 800));
  if (child.exitCode === null) child.kill('SIGKILL');
  rmSync(tmpHome, { recursive: true, force: true });
}

process.stdout.write('\n=== 总结 ===\n');
process.stdout.write(pass ? '✅ 跨阶段集成全部通过\n' : '❌ 有失败项\n');
process.exit(pass ? 0 : 1);
