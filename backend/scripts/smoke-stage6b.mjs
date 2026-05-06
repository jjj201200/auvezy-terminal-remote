/**
 * 阶段 6b 端到端 smoke：
 *
 * 1. 起 backend（带 frontend-dist）
 2. GET /  返回 200 + 含 <div id="root">（SPA 入口）
 3. SPA 资源应能 GET 到（/assets/*.js / .css）
 * 4. JS bundle 含 'instance-tab' / 'CreateInstanceModal' 字符串（验证 InstanceTabs 已编译进去）
 * 5. 跨端口跳转契约：GET /api/instances 返回的 host 字段是私有 IP（让前端能 location.assign）
 *
 * HOME 隔离 + 完整清理。
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';

const tmpHome = mkdtempSync(resolve(tmpdir(), 'ocr-stage6b-'));
const PORT = 3194;
let pass = true;
const cliJs = resolve(import.meta.dirname, '..', 'dist', 'cli.js');
const frontendDist = resolve(import.meta.dirname, '..', 'frontend-dist');

if (!existsSync(frontendDist)) {
  process.stdout.write(
    `[smoke] 前端未 build，先 pnpm -F @auvezy/terminal-remote-frontend build；当前 ${frontendDist} 不存在\n`,
  );
  process.exit(2);
}

const child = spawn(
  process.execPath,
  [cliJs, '--port', String(PORT), '--no-terminal'],
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
let stderr = '';
child.stderr.on('data', (b) => (stderr += b.toString()));

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
    process.stdout.write('  ✗ backend 未就绪\n  stderr:' + stderr + '\n');
    pass = false;
    throw new Error();
  }
  process.stdout.write('  ✓ backend ready\n');

  // 1) GET / 返回 SPA index.html
  process.stdout.write('\n[smoke] 1) GET / 返回 SPA HTML\n');
  const indexRes = await fetch(`http://127.0.0.1:${PORT}/`);
  const html = await indexRes.text();
  if (indexRes.status === 200 && html.includes('id="app"')) {
    process.stdout.write('  ✓ index.html 含 #app 容器\n');
  } else {
    process.stdout.write(`  ✗ ${indexRes.status} html 节选: ${html.slice(0, 200)}\n`);
    pass = false;
  }

  // 2) /assets/*.js 能加载
  process.stdout.write('\n[smoke] 2) 找 JS bundle 链接\n');
  const jsMatch = html.match(/\/assets\/index-[\w-]+\.js/);
  if (!jsMatch) {
    process.stdout.write('  ✗ 未在 HTML 中找到 JS 引用\n');
    pass = false;
    throw new Error();
  }
  const jsUrl = jsMatch[0];
  process.stdout.write(`  ✓ JS 路径：${jsUrl}\n`);

  const jsRes = await fetch(`http://127.0.0.1:${PORT}${jsUrl}`);
  if (jsRes.status !== 200) {
    process.stdout.write(`  ✗ JS 加载失败 ${jsRes.status}\n`);
    pass = false;
  } else {
    process.stdout.write(`  ✓ JS 加载成功\n`);
  }

  const jsText = await jsRes.text();

  // 3) JS 含 InstanceTabs / CreateInstanceModal 关键串（说明源码被打包进去）
  process.stdout.write('\n[smoke] 3) JS 含多实例 UI 关键串\n');
  // 中文文案最可靠（不会被 mangle）
  const checks = [
    { needle: '创建新实例', label: 'CreateInstanceModal 标题' },
    { needle: '实例切换', label: 'InstanceTabs aria-label' },
  ];
  for (const c of checks) {
    if (jsText.includes(c.needle)) {
      process.stdout.write(`  ✓ ${c.label} 存在\n`);
    } else {
      process.stdout.write(`  ✗ ${c.label} 不存在\n`);
      pass = false;
    }
  }

  // 4) GET /api/instances（先登录）
  process.stdout.write('\n[smoke] 4) GET /api/instances 返回 host 是私有 IP（让前端能跨端口跳）\n');
  const fs = await import('node:fs');
  const cfg = JSON.parse(
    fs.readFileSync(resolve(tmpHome, '.claude-remote', 'config.json'), 'utf-8'),
  );
  const auth = await fetch(`http://127.0.0.1:${PORT}/api/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: cfg.token }),
  });
  const cookie = auth.headers.get('set-cookie').split(';')[0];

  const list = await fetch(`http://127.0.0.1:${PORT}/api/instances`, {
    headers: { Cookie: cookie },
  }).then((r) => r.json());
  const me = list.instances.find((i) => i.isCurrent);
  if (me && /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|127\.0\.0\.1$|169\.254\.)/.test(me.host)) {
    process.stdout.write(`  ✓ 当前实例 host=${me.host}\n`);
  } else {
    process.stdout.write(`  ✗ host 不对：${JSON.stringify(me)}\n`);
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
process.stdout.write(pass ? '✅ 阶段 6b 全部通过\n' : '❌ 有失败项\n');
process.exit(pass ? 0 : 1);
