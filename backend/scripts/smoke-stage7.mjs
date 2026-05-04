/**
 * 阶段 7 端到端 smoke：
 *
 * 1. 起 backend（PORT=3193）
 * 2. 用 ws 库直接以 attach 角色连入（带 ?token=...）
 * 3. 发 user_input → 服务端再读不到响应（因为 PTY 是 tail -f /dev/null），
 *    但应能收到 history_sync
 * 4. 主从仲裁验证：
 *    - 起一个 webapp WS（带 cookie）
 *    - 起一个 attach WS（带 ?token）
 *    - attach 发 resize → 应被忽略（webapp 在线）
 *    - 关掉 webapp → attach 发 resize → 应生效（PTY 实际尺寸更新通过
 *      terminal_resize 广播体现）
 *
 * 注：直接验证 attach.ts CLI 入口需要交互式 TTY，难以在脚本里用；
 * 这里直接验证服务端 attach 路径的行为。
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import WebSocket from 'ws';

const tmpHome = mkdtempSync(resolve(tmpdir(), 'ocr-stage7-'));
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

function openWs(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, { headers });
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error('WS open timeout'));
    }, 3000);
    ws.once('open', () => {
      clearTimeout(timer);
      resolve(ws);
    });
    ws.once('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    ws.once('unexpected-response', (_req, res) => {
      clearTimeout(timer);
      reject(new Error(`HTTP ${res.statusCode}`));
    });
  });
}

try {
  if (!(await waitReady())) {
    process.stdout.write('  ✗ backend 未就绪\n');
    pass = false;
    throw new Error();
  }
  process.stdout.write('  ✓ backend ready\n');

  const cfgPath = resolve(tmpHome, '.claude-remote', 'config.json');
  const token = JSON.parse(readFileSync(cfgPath, 'utf-8')).token;

  // 1) attach 角色 WS（URL 带 token）
  process.stdout.write('\n[smoke] 1) attach WS 用 ?token 连入\n');
  const attachWs = await openWs(
    `ws://127.0.0.1:${PORT}/ws?token=${encodeURIComponent(token)}`,
  );
  process.stdout.write('  ✓ attach 已连接\n');

  const attachMsgs = [];
  attachWs.on('message', (raw) => {
    try {
      attachMsgs.push(JSON.parse(raw.toString()));
    } catch {
      /* */
    }
  });

  // history_sync
  await new Promise((r) => setTimeout(r, 500));
  if (attachMsgs.find((m) => m.type === 'history_sync')) {
    process.stdout.write('  ✓ 收到 history_sync\n');
  } else {
    process.stdout.write('  ✗ 未收到 history_sync\n');
    pass = false;
  }

  // 2) webapp 角色 WS（用 cookie）
  process.stdout.write('\n[smoke] 2) 启 webapp 角色 WS（cookie 认证）\n');
  const auth = await fetch(`http://127.0.0.1:${PORT}/api/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  });
  const cookie = auth.headers.get('set-cookie').split(';')[0];
  const webappWs = await openWs(`ws://127.0.0.1:${PORT}/ws`, { Cookie: cookie });
  process.stdout.write('  ✓ webapp 已连接\n');

  const webappMsgs = [];
  webappWs.on('message', (raw) => {
    try {
      webappMsgs.push(JSON.parse(raw.toString()));
    } catch {
      /* */
    }
  });
  await new Promise((r) => setTimeout(r, 300));

  // 3) attach 发 resize → 应被忽略
  process.stdout.write(
    '\n[smoke] 3) webapp 在线时 attach 的 resize 应被忽略（PTY 不 resize）\n',
  );
  webappMsgs.length = 0;
  attachWs.send(JSON.stringify({ type: 'resize', cols: 200, rows: 60 }));
  await new Promise((r) => setTimeout(r, 400));
  // 没有 PTY size resize 触发的话，服务端不会广播 terminal_resize
  const tr1 = webappMsgs.find((m) => m.type === 'terminal_resize');
  if (!tr1) {
    process.stdout.write('  ✓ webapp 没收到 terminal_resize（attach resize 被忽略）\n');
  } else {
    process.stdout.write(`  ✗ 不应收到 terminal_resize：${JSON.stringify(tr1)}\n`);
    pass = false;
  }

  // 4) webapp 发 resize → 应生效（先选个不同尺寸，避免 PtyManager 同尺寸去重）
  process.stdout.write('\n[smoke] 4) webapp 发 resize → PTY 实际 resize → attach 收到 terminal_resize\n');
  attachMsgs.length = 0;
  webappWs.send(JSON.stringify({ type: 'resize', cols: 90, rows: 28 }));
  await new Promise((r) => setTimeout(r, 400));
  const tr2 = attachMsgs.find(
    (m) => m.type === 'terminal_resize' && m.cols === 90 && m.rows === 28,
  );
  if (tr2) {
    process.stdout.write('  ✓ attach 收到 90x28 terminal_resize\n');
  } else {
    process.stdout.write(
      `  ✗ 期望 90x28，收到：${JSON.stringify(attachMsgs.filter((m) => m.type === 'terminal_resize'))}\n`,
    );
    pass = false;
  }

  // 5) 关掉 webapp 后，attach 应收到当前尺寸广播
  process.stdout.write('\n[smoke] 5) webapp 断开 → attach 应收到一次 terminal_resize 校准\n');
  attachMsgs.length = 0;
  webappWs.close();
  await new Promise((r) => setTimeout(r, 600));
  const tr3 = attachMsgs.find((m) => m.type === 'terminal_resize');
  if (tr3) {
    process.stdout.write(`  ✓ attach 收到校准 ${tr3.cols}x${tr3.rows}\n`);
  } else {
    process.stdout.write('  ✗ attach 未收到校准 terminal_resize\n');
    pass = false;
  }

  // 6) 仅 attach 在线时 attach 的 resize 生效
  process.stdout.write('\n[smoke] 6) 仅 attach 在线时它的 resize 应生效\n');
  attachMsgs.length = 0;
  attachWs.send(JSON.stringify({ type: 'resize', cols: 110, rows: 35 }));
  await new Promise((r) => setTimeout(r, 400));
  const tr4 = attachMsgs.find(
    (m) => m.type === 'terminal_resize' && m.cols === 110 && m.rows === 35,
  );
  if (tr4) {
    process.stdout.write('  ✓ attach resize 生效\n');
  } else {
    process.stdout.write(
      `  ✗ 未生效：${JSON.stringify(attachMsgs.filter((m) => m.type === 'terminal_resize'))}\n`,
    );
    pass = false;
  }

  attachWs.close();
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
process.stdout.write(pass ? '✅ 阶段 7 全部通过\n' : '❌ 有失败项\n');
process.exit(pass ? 0 : 1);
