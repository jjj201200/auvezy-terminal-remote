/**
 * 阶段 8 端到端 smoke：
 *
 * 1. 起 backend → 用 attach role WS 连入
 * 2. 让 PTY 输出含 alt-screen 序列：
 *      \x1b[?1049h hidden \x1b[?1049l visible
 *    通过给 bash -c 'printf ...' 注入。
 *    验证 history_sync 后续 reconnect 收到的 buffer 不含 'hidden'
 * 3. IP 变化广播：用 ws 发不出 — 直接验证 IpMonitor 触发回调能广播 ip_changed。
 *    我们没法真改 IP，所以这步用 backend/dist 的 IpMonitor 不可行；
 *    转而用本地 vitest 已经覆盖；smoke 用单独的小 ws 模拟"ip_changed 消息"
 *    收到时前端类型可识别（验证 ServerMessage union）。
 *
 * 这里 smoke 只覆盖 (1)(2)；ip-monitor 的回调 → 广播路径已被
 * ip-monitor 单测 + index.ts 配线（typecheck）覆盖。
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import WebSocket from 'ws';

const tmpHome = mkdtempSync(resolve(tmpdir(), 'ocr-stage8-'));
const PORT = 3192;
let pass = true;
const cliJs = resolve(import.meta.dirname, '..', 'dist', 'cli.js');

// 让 PTY 输出 alt-screen 序列：进入 / 显示一段 hidden / 退出 / 显示 visible
// 使用 bash -c 'printf ...' 一次性产出后保持运行
const altScript = `printf '\\x1b[?1049hhidden\\x1b[?1049lvisible\\n'; tail -f /dev/null`;

const child = spawn(
  process.execPath,
  [cliJs, '--port', String(PORT), '--no-terminal'],
  {
    env: {
      ...process.env,
      HOME: tmpHome,
      OCR_COMMAND: 'bash',
      OCR_ARGS: JSON.stringify(['-c', altScript, '--']),
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

try {
  if (!(await waitReady())) {
    process.stdout.write('  ✗ backend 未就绪\n');
    pass = false;
    throw new Error();
  }
  process.stdout.write('  ✓ backend ready\n');

  const cfgPath = resolve(tmpHome, '.claude-remote', 'config.json');
  const token = JSON.parse(readFileSync(cfgPath, 'utf-8')).token;

  // 让 PTY 把 altScript 输出跑完
  await new Promise((r) => setTimeout(r, 800));

  // 用 attach 角色连入并收 history_sync
  process.stdout.write('\n[smoke] 1) 连入 → 收 history_sync 不应含 alt-screen 内的 "hidden"\n');
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws?token=${encodeURIComponent(token)}`);
  const got = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), 5000);
    ws.once('open', () => {
      // 等收 history_sync
    });
    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'history_sync') {
          clearTimeout(timer);
          resolve(msg);
        }
      } catch {
        /* */
      }
    });
    ws.once('error', reject);
  });

  ws.close();

  if (typeof got.data === 'string' && !got.data.includes('hidden') && got.data.includes('visible')) {
    process.stdout.write(`  ✓ history_sync 含 'visible' 不含 'hidden'\n`);
  } else {
    process.stdout.write(
      `  ✗ history_sync 内容不对：${JSON.stringify(got.data)}\n`,
    );
    pass = false;
  }

  // 2) ip-monitor 路径：让 backend 端到端走一遍很难（我们改不了机器的 IP）。
  // 但我们可以单独测 ServerMessage union 包含 ip_changed —— 通过 shared 的
  // isServerMessage 类型守卫即可（已在 ws-protocol.test.ts 里覆盖）。
  process.stdout.write(
    '\n[smoke] 2) ip_changed 协议层：跳过（机器层面 IP 变化无法在 smoke 中模拟，由单测 ip-monitor.test.ts 覆盖）\n',
  );
  process.stdout.write('  ✓ skipped\n');
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
process.stdout.write(pass ? '✅ 阶段 8 全部通过\n' : '❌ 有失败项\n');
process.exit(pass ? 0 : 1);
