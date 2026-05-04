/**
 * 阶段 3 端到端 smoke：
 *
 * 1. 起一个完整 backend（PORT + AUTH_TOKEN 必传）
 * 2. WS 用 Cookie 认证连入（webapp 路径）
 * 3. 模拟 Claude 触发 hook：本地 POST /api/hook，body 含 permission_prompt
 * 4. 在 WS 上应该收到 status_update / status='waiting_input' 消息
 * 5. POST /api/hook 用伪造来源（X-Forwarded-For 在不开 trust proxy 的情况下不会生效，
 *    所以这里不再次验证非 loopback 拒绝——已被 hook-routes.test.ts 覆盖）
 *
 * 用法：
 *   PORT=3000 AUTH_TOKEN=<token> node scripts/smoke-stage3.mjs
 */
import { WebSocket } from 'ws';

const PORT = Number(process.env.PORT || 3000);
const TOKEN = process.env.AUTH_TOKEN;
if (!TOKEN) {
  console.error('[smoke] 需要设置 AUTH_TOKEN 环境变量');
  process.exit(2);
}

const baseUrl = `http://127.0.0.1:${PORT}`;
let pass = true;

async function postAuth(token) {
  const res = await fetch(`${baseUrl}/api/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  });
  return { status: res.status, setCookie: res.headers.get('set-cookie') };
}

console.log('[smoke] 1) 拿 cookie');
const auth = await postAuth(TOKEN);
if (auth.status !== 200 || !auth.setCookie) {
  console.log('  ✗ 认证失败', auth);
  process.exit(1);
}
const cookie = auth.setCookie.split(';')[0];
console.log('  ✓ cookie =', cookie);

console.log('[smoke] 2) 用 cookie 建立 WS 连接');
const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`, {
  headers: { Cookie: cookie },
});

/** 收到的所有消息，供后续断言使用 */
const received = [];
const waitForMessage = (predicate, timeoutMs = 3000) =>
  new Promise((resolve) => {
    // 先扫已收到
    const found = received.find(predicate);
    if (found) return resolve(found);
    const t = setTimeout(() => resolve(null), timeoutMs);
    const onMsg = (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        received.push(msg);
        if (predicate(msg)) {
          clearTimeout(t);
          ws.off('message', onMsg);
          resolve(msg);
        }
      } catch {
        /* ignore */
      }
    };
    ws.on('message', onMsg);
  });

ws.on('message', (raw) => {
  try {
    received.push(JSON.parse(raw.toString()));
  } catch {
    /* ignore */
  }
});

await new Promise((resolve, reject) => {
  ws.once('open', resolve);
  ws.once('error', reject);
  setTimeout(() => reject(new Error('WS open timeout')), 3000);
});
console.log('  ✓ WS 已连接');

console.log('[smoke] 3) 等待 history_sync（确认正常对话已建立）');
const hist = await waitForMessage((m) => m.type === 'history_sync', 3000);
if (!hist) {
  console.log('  ✗ 未收到 history_sync');
  pass = false;
} else {
  console.log(`  ✓ history_sync.status=${hist.status}`);
}

console.log('[smoke] 4) POST /api/hook 模拟 permission_prompt');
const hookRes = await fetch(`${baseUrl}/api/hook`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    notification_type: 'permission_prompt',
    tool_name: 'Bash',
    message: 'Claude needs your permission to use Bash',
  }),
});
const hookBody = await hookRes.json();
if (hookRes.status === 200 && hookBody.ok && hookBody.tool === 'Bash') {
  console.log('  ✓ /api/hook → 200 tool=Bash');
} else {
  console.log('  ✗ /api/hook 不对', hookRes.status, hookBody);
  pass = false;
}

console.log('[smoke] 5) WS 应在 1s 内收到 status_update.waiting_input');
const statusMsg = await waitForMessage(
  (m) => m.type === 'status_update' && m.status === 'waiting_input',
  2000,
);
if (statusMsg) {
  console.log(`  ✓ 收到 waiting_input：detail="${statusMsg.detail ?? ''}"`);
  if (!statusMsg.detail || !statusMsg.detail.includes('Bash')) {
    console.log('  ⚠ detail 字段未含工具名 Bash');
    pass = false;
  }
} else {
  console.log('  ✗ 未在窗口内收到 status_update.waiting_input');
  pass = false;
}

console.log('[smoke] 6) POST /api/hook 非 permission_prompt → ignored 不广播');
const beforeLen = received.length;
const ignoreRes = await fetch(`${baseUrl}/api/hook`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ notification_type: 'idle', message: 'just idle' }),
});
const ignoreBody = await ignoreRes.json();
if (ignoreRes.status === 200 && ignoreBody.ignored === true) {
  console.log('  ✓ /api/hook ignored=true');
} else {
  console.log('  ✗ ignored 不对', ignoreBody);
  pass = false;
}
// 给 50ms 让任何意外广播到达
await new Promise((r) => setTimeout(r, 100));
const newStatusUpdates = received
  .slice(beforeLen)
  .filter((m) => m.type === 'status_update');
if (newStatusUpdates.length === 0) {
  console.log('  ✓ 未触发额外 status_update');
} else {
  console.log('  ✗ 不应触发，但收到', newStatusUpdates);
  pass = false;
}

ws.close();

console.log('\n=== 总结 ===');
console.log(pass ? '✅ 阶段 3 全部通过' : '❌ 有失败项');
process.exit(pass ? 0 : 1);
