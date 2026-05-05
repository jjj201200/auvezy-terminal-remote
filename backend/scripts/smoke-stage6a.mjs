/**
 * 阶段 6a 端到端 smoke：
 *
 * 1. 起 instance A（preferred=3195）→ 注册到 instances.json
 * 2. 起 instance B（preferred=3195，A 占着 → 自动 3196）
 *    - B 应能 list 到 A + B 两条
 * 3. /api/instances（B 的）应有 isCurrent=true 标记 B
 * 4. POST /api/instances 派生新 headless 实例（cwd=/tmp）
 *    - 等 1.5s → list 应见 3 条
 * 5. claude-remote stop 派生出来的那条 → 列表回到 2 条
 *
 * HOME 隔离到 tmpdir，全程清理。
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';

const tmpHome = mkdtempSync(resolve(tmpdir(), 'ocr-stage6a-'));
let pass = true;
const cliJs = resolve(import.meta.dirname, '..', 'dist', 'cli.js');

function start(port) {
  return spawn(
    process.execPath,
    [cliJs, '--port', String(port), '--no-terminal', '--max-buffer-lines', '200'],
    {
      env: {
        ...process.env,
        HOME: tmpHome,
        OCR_COMMAND: 'bash',
        OCR_ARGS: JSON.stringify(['-c', 'tail -f /dev/null', '--']),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
}

async function waitReady(port, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (r.ok) return true;
    } catch {
      /* not ready */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

async function killAndWait(child) {
  if (child.exitCode !== null) return;
  child.kill('SIGTERM');
  for (let i = 0; i < 30; i++) {
    if (child.exitCode !== null) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  child.kill('SIGKILL');
  await new Promise((r) => setTimeout(r, 200));
}

async function login(port, token) {
  const res = await fetch(`http://127.0.0.1:${port}/api/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  });
  if (res.status !== 200) throw new Error(`login fail ${res.status}`);
  return res.headers.get('set-cookie').split(';')[0];
}

async function readToken() {
  const cfgPath = resolve(tmpHome, '.claude-remote', 'config.json');
  if (!existsSync(cfgPath)) throw new Error('config.json missing');
  return JSON.parse(readFileSync(cfgPath, 'utf-8')).token;
}

let a, b;
try {
  process.stdout.write(`[smoke] tmpHome=${tmpHome}\n`);

  // 1) A
  process.stdout.write('\n[smoke] 1) instance A 起在 3195\n');
  a = start(3195);
  if (!(await waitReady(3195))) {
    process.stdout.write('  ✗ A 未就绪\n');
    pass = false;
    throw new Error();
  }
  process.stdout.write('  ✓ A ready\n');

  // 2) B（preferred=3195 被占 → 应自动 3196）
  process.stdout.write('\n[smoke] 2) instance B 也 preferred=3195 → 应自动 3196\n');
  b = start(3195);
  let stderrB = '';
  b.stderr.on('data', (x) => (stderrB += x.toString()));
  if (!(await waitReady(3196))) {
    process.stdout.write('  ✗ B 未就绪 / 没递增\n');
    process.stdout.write('  stderrB:\n' + stderrB.slice(0, 1500) + '\n');
    pass = false;
    throw new Error();
  }
  process.stdout.write('  ✓ B 起在 3196（自动递增成功）\n');

  // 给注册表落盘
  await new Promise((r) => setTimeout(r, 600));

  const token = await readToken();
  const cookieB = await login(3196, token);

  // 3) GET /api/instances（B）应有 2 条；isCurrent 仅 B
  process.stdout.write('\n[smoke] 3) GET /api/instances（B）应见 A + B；B isCurrent=true\n');
  const listRes = await fetch('http://127.0.0.1:3196/api/instances', {
    headers: { Cookie: cookieB },
  });
  const listBody = await listRes.json();
  if (
    listRes.status !== 200 ||
    !Array.isArray(listBody.instances) ||
    listBody.instances.length !== 2
  ) {
    process.stdout.write(`  ✗ 不对 ${listRes.status} ${JSON.stringify(listBody)}\n`);
    pass = false;
  } else {
    const cur = listBody.instances.filter((i) => i.isCurrent);
    const ports = listBody.instances.map((i) => i.port).sort();
    if (cur.length === 1 && cur[0].port === 3196 && ports.join(',') === '3195,3196') {
      process.stdout.write('  ✓ 2 条；B isCurrent=true\n');
    } else {
      process.stdout.write(
        `  ✗ isCurrent 或 ports 不对 cur=${JSON.stringify(cur.map((i) => i.port))} ports=${ports}\n`,
      );
      pass = false;
    }
  }

  // 4) POST /api/instances 派生新 headless 实例（cwd=tmpHome）
  process.stdout.write('\n[smoke] 4) POST /api/instances 派生 headless 实例\n');
  const spawnRes = await fetch('http://127.0.0.1:3196/api/instances', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookieB },
    body: JSON.stringify({ cwd: tmpHome, name: 'derived' }),
  });
  const spawnBody = await spawnRes.json();
  if (spawnRes.status !== 200 || typeof spawnBody.instance?.pid !== 'number') {
    process.stdout.write(`  ✗ 不对 ${spawnRes.status} ${JSON.stringify(spawnBody)}\n`);
    pass = false;
  } else {
    process.stdout.write(`  ✓ 派生成功 pid=${spawnBody.instance.pid}\n`);
  }

  // 等待派生进程注册完成（轮询直到看到或 8s 超时）
  let derived;
  let list2;
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    list2 = await fetch('http://127.0.0.1:3196/api/instances', {
      headers: { Cookie: cookieB },
    }).then((r) => r.json());
    derived = list2.instances.find((i) => i.name === 'derived');
    if (derived) break;
    await new Promise((r) => setTimeout(r, 300));
  }
  if (derived) {
    process.stdout.write(`  ✓ list 含派生实例 port=${derived.port}\n`);
  } else {
    process.stdout.write(
      `  ✗ list 未见派生实例：${JSON.stringify(list2.instances.map((i) => `${i.name}@${i.port}`))}\n`,
    );
    // 直接读注册表文件看
    try {
      const reg = JSON.parse(
        readFileSync(resolve(tmpHome, '.claude-remote', 'instances.json'), 'utf-8'),
      );
      process.stdout.write('  注册表文件：' + JSON.stringify(reg.instances.map((i) => `${i.name}@${i.port} pid=${i.pid}`)) + '\n');
    } catch (err) {
      process.stdout.write('  注册表读失败：' + err.message + '\n');
    }
    pass = false;
  }

  // 5) claude-remote stop derived → list 回到 2 条
  process.stdout.write('\n[smoke] 5) claude-remote stop derived\n');
  const stopProc = spawn(
    process.execPath,
    [cliJs, 'stop', 'derived'],
    {
      env: { ...process.env, HOME: tmpHome },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let stopOut = '';
  stopProc.stdout.on('data', (b) => (stopOut += b.toString()));
  await new Promise((r) => stopProc.once('close', r));
  process.stdout.write('  stop 输出：' + stopOut.replace(/\n/g, ' | '));
  process.stdout.write('\n');

  await new Promise((r) => setTimeout(r, 1500));
  let list3;
  try {
    const r = await fetch('http://127.0.0.1:3196/api/instances', {
      headers: { Cookie: cookieB },
    });
    process.stdout.write(`  list3 status=${r.status}\n`);
    list3 = await r.json();
  } catch (e) {
    process.stdout.write('  list3 fetch failed: ' + e.message + '\n');
    process.stdout.write(`  B alive? exitCode=${b?.exitCode}\n`);
  }
  if (Array.isArray(list3?.instances) && list3.instances.length === 2) {
    process.stdout.write('  ✓ list 回到 2 条\n');
  } else {
    process.stdout.write(
      `  ✗ list 应 2 条，实 ${list3?.instances?.length}: ${JSON.stringify(list3?.instances?.map((i) => i.name))}\n`,
    );
    pass = false;
  }
} catch (err) {
  process.stdout.write(`异常：${err?.message ?? err}\n`);
  pass = false;
} finally {
  if (a) await killAndWait(a);
  if (b) await killAndWait(b);
  // 兜底：用 stop list 模式杀掉派生进程，防止泄漏
  try {
    const cleanup = spawn(process.execPath, [cliJs, 'stop'], {
      env: { ...process.env, HOME: tmpHome },
      stdio: 'ignore',
    });
    await new Promise((r) => cleanup.once('close', r));
  } catch {
    /* ignore */
  }
  rmSync(tmpHome, { recursive: true, force: true });
}

process.stdout.write('\n=== 总结 ===\n');
process.stdout.write(pass ? '✅ 阶段 6a 全部通过\n' : '❌ 有失败项\n');
process.exit(pass ? 0 : 1);
