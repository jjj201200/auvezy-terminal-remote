/**
 * `otr attach <url>` CLI 入口
 *
 * 把 process.stdin/stdout/SIGWINCH 接到 AttachClient：
 *  - stdin 进入 raw mode（不缓冲、不回显），原始字节直接 WS 透传
 *  - WS terminal_output → 写到 stdout（PC 终端自己解析 ANSI）
 *  - 终端 resize → SIGWINCH → 同步给服务端
 *  - Ctrl+C 双击（500ms 内）退出 attach（单击仍透传给远端）
 *  - 服务端 session_ended / fatal 都退出 attach
 *
 * URL 来源：argv 已被 cli-utils 解析，attach.ts 只接收 url 字符串。
 */

import {
  AttachClient,
  type AttachConnectionStatus,
} from './attach/attach-client.js';
import { DOUBLE_CTRL_C_WINDOW_MS } from './constants.js';

/**
 * 主入口：返回 exit code
 */
export async function runAttachCli(url: string): Promise<number> {
  // 终端必须是 TTY，否则原始 stdin/stdout 没法 raw mode
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    process.stderr.write('[otr] attach 需要交互式终端\n');
    return 2;
  }

  const client = new AttachClient({ url });

  // ────────── stdout：WS 输出 → 终端 ──────────
  client.on('output', (data) => {
    process.stdout.write(data);
  });

  client.on('resize', (cols, rows) => {
    // 提示用户：远端已切到此尺寸；本地物理终端尺寸可能不一致——告知一下
    // 实际渲染由 stdout 直接吞 ANSI 序列，这里只是日志
    process.stderr.write(`\x1b[2K\r[remote resize ${cols}x${rows}]\n`);
  });

  client.on('status', (status, detail) => {
    process.stderr.write(`\x1b[2K\r[remote status: ${status}${detail ? ` · ${detail}` : ''}]\n`);
  });

  client.on('connectionStatus', (s: AttachConnectionStatus) => {
    if (s === 'disconnected') {
      process.stderr.write('\x1b[2K\r[attach 已断开，自动重连中…]\n');
    } else if (s === 'connected') {
      process.stderr.write('\x1b[2K\r[attach 已连接]\n');
    }
  });

  let exitCode = 0;
  const finish = (code: number): void => {
    exitCode = code;
    cleanup();
  };
  client.on('sessionEnded', (code, reason) => {
    process.stderr.write(`\x1b[2K\r[远端会话结束 · exit ${code} · ${reason}]\n`);
    finish(code);
  });
  client.on('fatal', (msg) => {
    process.stderr.write(`\x1b[31m[attach 致命错误] ${msg}\x1b[0m\n`);
    finish(1);
  });

  // ────────── stdin：终端 → WS ──────────
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf8');

  // 双 Ctrl+C 检测
  let lastCtrlC = 0;
  const onStdin = (chunk: string): void => {
    // 单字节 0x03 = Ctrl+C
    if (chunk === '\x03') {
      const now = Date.now();
      if (now - lastCtrlC <= DOUBLE_CTRL_C_WINDOW_MS) {
        process.stderr.write('\n[otr] 双 Ctrl+C：断开 attach\n');
        finish(0);
        return;
      }
      lastCtrlC = now;
    }
    client.write(chunk);
  };
  process.stdin.on('data', onStdin);

  // ────────── SIGWINCH → resize ──────────
  const reportResize = (): void => {
    if (process.stdout.columns && process.stdout.rows) {
      client.resize(process.stdout.columns, process.stdout.rows);
    }
  };
  process.on('SIGWINCH', reportResize);
  // 启动后立即报一次本地终端尺寸
  setTimeout(reportResize, 100);

  // ────────── SIGINT/SIGTERM → 退出 ──────────
  const onSig = (): void => finish(0);
  process.on('SIGINT', onSig);
  process.on('SIGTERM', onSig);

  // ────────── 清理 ──────────
  let cleanedUp = false;
  function cleanup(): void {
    if (cleanedUp) return;
    cleanedUp = true;
    try {
      process.stdin.setRawMode(false);
    } catch {
      /* ignore */
    }
    process.stdin.off('data', onStdin);
    process.stdin.pause();
    process.off('SIGWINCH', reportResize);
    process.off('SIGINT', onSig);
    process.off('SIGTERM', onSig);
    client.destroy();
  }

  // 启动连接
  client.connect();
  process.stderr.write(`[attach] 连接 ${url}\n`);

  // 等到 cleanup 触发后退出
  return new Promise<number>((resolve) => {
    const wait = setInterval(() => {
      if (cleanedUp) {
        clearInterval(wait);
        resolve(exitCode);
      }
    }, 100);
  });
}
