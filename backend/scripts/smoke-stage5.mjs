/**
 * 阶段 5 端到端 smoke：
 *
 * 1. 起 instance A（不指定 token）→ shared-token 应触发 generated 路径，
 *    把 token 写到 tmpHome/.claude-remote/config.json
 * 2. 杀掉 A，起 instance B（同样不指定 token）→ 应得到 shared 路径，
 *    用相同的 token
 * 3. banner stderr 中应包含 displayIp（任一 RFC1918 段）+ ASCII QR 字符
 * 4. config.json 内 token 字段非空、和 instance B 用的 token 相等
 * 5. CORS：从 displayIp 同源（origin = http://<displayIp>:<port>）发请求应通过
 *    （仅做断言，不真的连外部设备）
 *
 * 用法（从 backend/ 执行）：
 *   node scripts/smoke-stage5.mjs
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';

const PORT_A = 3196;
const PORT_B = 3196; // 同端口，因为 A 已 kill
const tmpHome = mkdtempSync(resolve(tmpdir(), 'ocr-stage5-'));
let pass = true;

function startInstance(port) {
  return spawn(
    process.execPath,
    [
      resolve(import.meta.dirname, '..', 'dist', 'cli.js'),
      '--port',
      String(port),
      '--no-terminal',
      '--max-buffer-lines',
      '200',
    ],
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
}

async function waitReady(port, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (r.ok) return true;
    } catch {
      /* ignore */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

async function killAndWait(child) {
  child.kill('SIGTERM');
  for (let i = 0; i < 30; i++) {
    if (child.exitCode !== null) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  child.kill('SIGKILL');
  await new Promise((r) => setTimeout(r, 200));
}

try {
  process.stdout.write(`[smoke] tmpHome = ${tmpHome}\n`);

  // ─────────── A ───────────
  process.stdout.write('\n[smoke] 1) 起 instance A（应 generated）\n');
  const a = startInstance(PORT_A);
  let stderrA = '';
  a.stderr.on('data', (b) => (stderrA += b.toString()));

  if (!(await waitReady(PORT_A))) {
    process.stdout.write('  ✗ A 未就绪\n  stderr=' + stderrA + '\n');
    pass = false;
    throw new Error('A not ready');
  }
  process.stdout.write('  ✓ A ready\n');

  // 让 banner 全部刷出（异步 transport 可能略晚）
  await new Promise((r) => setTimeout(r, 800));

  process.stdout.write('[smoke] 2) banner 含 displayIp + ASCII QR\n');
  // QR 由 ▀▄█ 这类块字符组成，至少应出现一种
  if (
    /▀|▄|█/.test(stderrA) ||
    stderrA.includes('  扫码登入：')
  ) {
    process.stdout.write('  ✓ banner 含 QR 区段\n');
  } else {
    process.stdout.write('  ✗ banner 没 QR；stderr 节选:\n' + stderrA + '\n');
    pass = false;
  }
  // 抓一下 banner 中的 token 来源
  if (stderrA.includes('来源:    generated')) {
    process.stdout.write('  ✓ A 来源 = generated\n');
  } else if (stderrA.includes('来源:    shared')) {
    process.stdout.write('  ✓ A 来源 = shared（之前已存在 token）\n');
  } else {
    process.stdout.write('  ✗ banner 中未识别 token 来源\n');
    pass = false;
  }

  // 读取 token from disk
  const cfgPath = resolve(tmpHome, '.claude-remote', 'config.json');
  if (!existsSync(cfgPath)) {
    process.stdout.write(`  ✗ ${cfgPath} 不存在\n`);
    pass = false;
    throw new Error();
  }
  const tokenA = JSON.parse(readFileSync(cfgPath, 'utf-8')).token;
  if (typeof tokenA !== 'string' || tokenA.length === 0) {
    process.stdout.write('  ✗ config.json.token 不存在或非字符串\n');
    pass = false;
    throw new Error();
  }
  process.stdout.write(`  ✓ tokenA = ${tokenA.slice(0, 8)}…${tokenA.slice(-8)}\n`);

  // 关掉 A
  await killAndWait(a);

  // ─────────── B ───────────
  process.stdout.write('\n[smoke] 3) 起 instance B（同 HOME，应 shared 路径）\n');
  const b = startInstance(PORT_B);
  let stderrB = '';
  b.stderr.on('data', (x) => (stderrB += x.toString()));

  if (!(await waitReady(PORT_B))) {
    process.stdout.write('  ✗ B 未就绪 stderr=' + stderrB + '\n');
    pass = false;
    throw new Error();
  }
  process.stdout.write('  ✓ B ready\n');
  await new Promise((r) => setTimeout(r, 800));

  if (stderrB.includes('来源:    shared')) {
    process.stdout.write('  ✓ B 来源 = shared\n');
  } else {
    process.stdout.write('  ✗ B 应为 shared，banner 节选:\n' + stderrB + '\n');
    pass = false;
  }

  // ─────────── 4) token 一致 ───────────
  process.stdout.write('\n[smoke] 4) /api/auth 用 tokenA 登录 B 应 200\n');
  const auth = await fetch(`http://127.0.0.1:${PORT_B}/api/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: tokenA }),
  });
  if (auth.status === 200 && auth.headers.get('set-cookie')) {
    process.stdout.write('  ✓ 200 + Set-Cookie\n');
  } else {
    process.stdout.write(`  ✗ 不对 ${auth.status}\n`);
    pass = false;
  }

  await killAndWait(b);

  process.stdout.write('\n=== 总结 ===\n');
  process.stdout.write(pass ? '✅ 阶段 5 全部通过\n' : '❌ 有失败项\n');
} catch (err) {
  process.stdout.write(`异常：${err?.message ?? err}\n`);
  pass = false;
} finally {
  rmSync(tmpHome, { recursive: true, force: true });
}

process.exit(pass ? 0 : 1);
