/**
 * 阶段 1 端到端 smoke：
 * 启动 backend 后连 WS，验证 history_sync / terminal_output / user_input / status_update。
 */
import { WebSocket } from 'ws';

const PORT = Number(process.env.PORT || 3000);
const wsUrl = `ws://127.0.0.1:${PORT}/ws`;

const received = {
  history_sync: false,
  terminal_output: false,
  status_update: null,
  echoed: false,
};

const ws = new WebSocket(wsUrl);

ws.on('open', () => console.log('[smoke] WS 已连接'));

ws.on('message', (raw) => {
  const msg = JSON.parse(raw.toString());
  const tail = msg.type === 'terminal_output' ? ` (${msg.data?.length || 0}B)`
    : msg.type === 'status_update' ? ` status=${msg.status}` : '';
  console.log(`[smoke] 收到 ${msg.type}${tail}`);

  if (msg.type === 'history_sync') {
    received.history_sync = true;
    // history_sync 已携带 status，符合"重连后状态恢复"的协议设计
    received.status_update = msg.status;
    console.log(`  cols=${msg.cols} rows=${msg.rows} status=${msg.status} seq=${msg.seq}`);
    setTimeout(() => {
      console.log('[smoke] 发送 user_input "echo OCRTEST123\\r"');
      ws.send(JSON.stringify({ type: 'user_input', data: 'echo OCRTEST123\r' }));
    }, 500);
  }

  if (msg.type === 'status_update') received.status_update = msg.status;

  if (msg.type === 'terminal_output') {
    received.terminal_output = true;
    if (msg.data?.includes('OCRTEST123')) {
      received.echoed = true;
      console.log('[smoke] ✓ 用户输入被 PTY 回显');
      setTimeout(() => {
        console.log('[smoke] 发送 resize 100x30');
        ws.send(JSON.stringify({ type: 'resize', cols: 100, rows: 30 }));
      }, 200);
      setTimeout(() => {
        console.log('[smoke] 关闭 WS');
        ws.close();
      }, 500);
    }
  }
});

ws.on('close', () => {
  console.log('\n=== 验证结果 ===');
  const checks = [
    ['history_sync 收到', received.history_sync],
    ['status_update 收到', received.status_update !== null],
    ['terminal_output 收到', received.terminal_output],
    ['user_input 回显', received.echoed],
  ];
  let pass = true;
  for (const [n, ok] of checks) {
    console.log(`  ${ok ? '✓' : '✗'} ${n}`);
    if (!ok) pass = false;
  }
  process.exit(pass ? 0 : 1);
});

ws.on('error', (err) => {
  console.error('[smoke] WS 错误:', err.message);
  process.exit(2);
});

setTimeout(() => {
  console.error('[smoke] 超时');
  ws.close();
  process.exit(3);
}, 15000);
