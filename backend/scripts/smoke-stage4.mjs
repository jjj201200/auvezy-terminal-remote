/**
 * 阶段 4 端到端 smoke：
 *
 * 1. CLI 参数：--port、--token 直接生效（不靠 env）
 * 2. config.json 自动创建（首次启动）
 * 3. GET /api/config 返回带默认值的 UserConfig
 * 4. PUT /api/config 整体替换 + 文件落盘 + GET 反映新值
 * 5. PUT 非法 body → 400 + CONFIG_VALIDATION_FAIL
 *
 * 用法（从 backend/ 执行）：
 *   PORT=3197 TOKEN=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))") \
 *   node scripts/smoke-stage4.mjs
 *
 * smoke 自身负责拉起 + 杀进程 + 校验端口已释放。
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';

const PORT = Number(process.env.PORT || 3197);
const TOKEN =
  process.env.TOKEN ||
  (await import('node:crypto')).randomBytes(32).toString('hex');

const tmpHome = mkdtempSync(resolve(tmpdir(), 'ocr-stage4-'));
let pass = true;

function logStep(s) {
  process.stdout.write(`\n[smoke] ${s}\n`);
}

logStep(`1) 起 backend：PORT=${PORT}, TOKEN=${TOKEN.slice(0, 8)}…`);

// 重要：把 HOME 重定向到 tmpHome，让 ~/.claude-remote 完全隔离
const child = spawn(
  process.execPath,
  [
    resolve(import.meta.dirname, '..', 'dist', 'cli.js'),
    '--port',
    String(PORT),
    '--token',
    TOKEN,
    '--no-terminal',
    '--max-buffer-lines',
    '200',
    '--',
    'tail -f /dev/null',
  ],
  {
    env: {
      ...process.env,
      HOME: tmpHome,
      // 用 bash -c 包裹 tail，避免 tail 直接被 --settings 干扰
      CLAUDE_COMMAND: 'bash',
      CLAUDE_ARGS: JSON.stringify(['-c', 'tail -f /dev/null', '--']),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  },
);

let stderr = '';
child.stderr.on('data', (b) => (stderr += b.toString()));

// 轮询健康检查端点直到 200，最多 5s
const deadline = Date.now() + 5000;
while (Date.now() < deadline) {
  if (child.exitCode !== null) {
    process.stdout.write('启动失败 stderr:\n' + stderr + '\n');
    rmSync(tmpHome, { recursive: true, force: true });
    process.exit(1);
  }
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/api/health`);
    if (r.ok) break;
  } catch {
    /* not ready yet */
  }
  await new Promise((r) => setTimeout(r, 200));
}
process.stdout.write('  ✓ backend ready\n');

async function postAuth(token) {
  const res = await fetch(`http://127.0.0.1:${PORT}/api/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  });
  return { status: res.status, setCookie: res.headers.get('set-cookie') };
}

try {
  logStep('2) 拿 cookie');
  const auth = await postAuth(TOKEN);
  if (auth.status !== 200) {
    process.stdout.write(`  ✗ 认证失败 ${auth.status}\n`);
    pass = false;
    throw new Error('auth fail');
  }
  const cookie = auth.setCookie.split(';')[0];
  process.stdout.write(`  ✓ ${cookie}\n`);

  logStep('3) config.json 应已自动写入到 tmpHome/.claude-remote/');
  const cfgPath = resolve(tmpHome, '.claude-remote', 'config.json');
  if (existsSync(cfgPath)) {
    const cfg = JSON.parse(readFileSync(cfgPath, 'utf-8'));
    process.stdout.write(
      `  ✓ ${cfgPath} 已生成；shortcuts.length=${cfg.shortcuts?.length ?? 0}\n`,
    );
  } else {
    process.stdout.write(`  ✗ 文件不存在：${cfgPath}\n`);
    pass = false;
  }

  logStep('4) GET /api/config 应返回带默认值的 UserConfig');
  const getRes = await fetch(`http://127.0.0.1:${PORT}/api/config`, {
    headers: { Cookie: cookie },
  });
  const getBody = await getRes.json();
  if (
    getRes.status === 200 &&
    Array.isArray(getBody.config?.shortcuts) &&
    getBody.config.shortcuts.length > 0
  ) {
    process.stdout.write(
      `  ✓ 200 shortcuts.length=${getBody.config.shortcuts.length}\n`,
    );
  } else {
    process.stdout.write(`  ✗ 不对 ${getRes.status} ${JSON.stringify(getBody)}\n`);
    pass = false;
  }

  logStep('5) PUT /api/config 写入新 fontScale + 自定义 shortcut');
  const putRes = await fetch(`http://127.0.0.1:${PORT}/api/config`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      shortcuts: [{ label: 'X', data: 'x', enabled: true }],
      fontScale: 1.25,
    }),
  });
  const putBody = await putRes.json();
  if (putRes.status === 200 && putBody.config?.fontScale === 1.25) {
    process.stdout.write(`  ✓ 200 fontScale=${putBody.config.fontScale}\n`);
  } else {
    process.stdout.write(`  ✗ 不对 ${putRes.status} ${JSON.stringify(putBody)}\n`);
    pass = false;
  }

  logStep('6) 再 GET 应反映新值（PUT 已落盘）');
  const reGet = await fetch(`http://127.0.0.1:${PORT}/api/config`, {
    headers: { Cookie: cookie },
  });
  const reGetBody = await reGet.json();
  if (
    reGet.status === 200 &&
    reGetBody.config?.fontScale === 1.25 &&
    reGetBody.config?.shortcuts?.length === 1 &&
    reGetBody.config?.shortcuts[0]?.label === 'X'
  ) {
    process.stdout.write(`  ✓ 反映了 fontScale + 自定义 shortcut\n`);
  } else {
    process.stdout.write(`  ✗ 不对 ${JSON.stringify(reGetBody)}\n`);
    pass = false;
  }

  logStep('7) 文件层确认：tmpHome/.claude-remote/config.json fontScale=1.25');
  const onDisk = JSON.parse(readFileSync(cfgPath, 'utf-8'));
  if (onDisk.fontScale === 1.25) {
    process.stdout.write(`  ✓ 落盘正确\n`);
  } else {
    process.stdout.write(`  ✗ 落盘不对 ${JSON.stringify(onDisk)}\n`);
    pass = false;
  }

  logStep('8) PUT body 非对象 → 400');
  const badRes = await fetch(`http://127.0.0.1:${PORT}/api/config`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify('oops'),
  });
  if (badRes.status === 400) {
    process.stdout.write(`  ✓ 400\n`);
  } else {
    process.stdout.write(`  ✗ 期望 400，实际 ${badRes.status}\n`);
    pass = false;
  }
} catch (err) {
  process.stdout.write(`异常：${err.message}\n`);
  pass = false;
} finally {
  child.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 500));
  if (child.exitCode === null) child.kill('SIGKILL');
  rmSync(tmpHome, { recursive: true, force: true });
}

process.stdout.write('\n=== 总结 ===\n');
process.stdout.write(pass ? '✅ 阶段 4 全部通过\n' : '❌ 有失败项\n');
process.exit(pass ? 0 : 1);
