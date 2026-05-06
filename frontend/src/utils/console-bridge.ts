/**
 * console-bridge
 *
 * 把前端 console 输出经由活跃 WS 转到 backend stdout，方便移动端调试。
 *
 * 设计：
 *  - install() 只劫持一次，幂等
 *  - 没有 sender 时把消息塞入 buffer（最多 200 条），WS 上线时 setSender
 *    会立刻 flush 一次
 *  - sender 拒绝（WS 未 OPEN）时消息回到 buffer 等下次连上
 *  - 原 console 行为完全保留（劫持只追加副作用）
 *  - 每条消息前置 [device:instance] 标签，多端共连同一 backend 时能区分来源
 *
 * 安全：发到 backend 的消息走加密 WS + 已认证连接，不会泄露给第三方。
 * 但仍仅在显式开启时启用（默认关闭，避免生产环境误开）。
 */

import type { ClientLogMessage } from 'auvezy-terminal-remote-shared';

type Level = ClientLogMessage['level'];
type LogEntry = { level: Level; message: string; ts: number };
type Sender = (msg: ClientLogMessage) => boolean;

const MAX_BUFFER = 200;
const buffer: LogEntry[] = [];
let activeSender: Sender | null = null;
let installed = false;

// 设备 tag：localStorage 持久化，跨刷新稳定。多端共连时区分来源
// 格式：<UA-种类>-<4位 hex 短码>，如 'iPhone-Chrome-A3F2'
const DEVICE_TAG_KEY = 'atr.devtools.deviceTag';
let deviceTag = '';
function getDeviceTag(): string {
  if (deviceTag) return deviceTag;
  if (typeof localStorage === 'undefined') return 'unknown';
  let saved = localStorage.getItem(DEVICE_TAG_KEY);
  if (!saved) {
    const ua = navigator.userAgent;
    const dev = /iPad/.test(ua)
      ? 'iPad'
      : /iPhone|iPod/.test(ua)
        ? 'iPhone'
        : /Android/.test(ua)
          ? 'Android'
          : /Macintosh/.test(ua)
            ? 'Mac'
            : /Windows/.test(ua)
              ? 'Win'
              : 'Linux';
    const browser = /CriOS|Chrome/.test(ua)
      ? 'Chrome'
      : /Firefox/.test(ua)
        ? 'FF'
        : /Safari/.test(ua)
          ? 'Safari'
          : /Edg/.test(ua)
            ? 'Edge'
            : 'Browser';
    const rand = Math.floor(Math.random() * 0xffff)
      .toString(16)
      .padStart(4, '0')
      .toUpperCase();
    saved = `${dev}-${browser}-${rand}`;
    localStorage.setItem(DEVICE_TAG_KEY, saved);
  }
  deviceTag = saved;
  return saved;
}

// 实例 tag：上层（useWebSocket / InstanceView）调 setConsoleBridgeInstance 设
// 通常是端口（3000/3001），切实例时更新
let instanceTag = '';
export function setConsoleBridgeInstance(tag: string): void {
  instanceTag = tag;
}

/** 把 unknown 序列化成可读字符串（递归 JSON.stringify，循环引用兜底） */
function serialize(v: unknown): string {
  if (typeof v === 'string') return v;
  if (v instanceof Error) return `${v.name}: ${v.message}\n${v.stack ?? ''}`;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

/** 把 device + instance tag 拼到 message 前 */
function tagMessage(message: string): string {
  const dev = getDeviceTag();
  const inst = instanceTag || '?';
  return `[${dev}:${inst}] ${message}`;
}

function tryFlush(): void {
  if (!activeSender || buffer.length === 0) return;
  // 取出全部，一条一条试发；发不出去就放回
  const pending = buffer.splice(0, buffer.length);
  for (const entry of pending) {
    const ok = activeSender({
      type: 'client_log',
      level: entry.level,
      message: tagMessage(entry.message),
      ts: entry.ts,
    });
    if (!ok) {
      // 发不出去：剩下的全推回 buffer，下次再试
      buffer.unshift(entry, ...pending.slice(pending.indexOf(entry) + 1));
      return;
    }
  }
}

function append(level: Level, args: unknown[]): void {
  const message = args.map(serialize).join(' ');
  buffer.push({ level, message, ts: Date.now() });
  if (buffer.length > MAX_BUFFER) buffer.shift();
  tryFlush();
}

/** 在所有 console.* 上挂副作用。原行为保留 */
export function installConsoleBridge(): void {
  if (installed) return;
  installed = true;
  const levels: Level[] = ['log', 'info', 'warn', 'error', 'debug'];
  for (const lv of levels) {
    const orig = console[lv].bind(console);
    console[lv] = (...args: unknown[]): void => {
      orig(...args);
      append(lv, args);
    };
  }
  // 全局 error / unhandledrejection 也捕获（移动端 try/catch 之外的崩溃）
  window.addEventListener('error', (e) => {
    append('error', [`[window.error] ${e.message} @ ${e.filename}:${e.lineno}:${e.colno}`]);
  });
  window.addEventListener('unhandledrejection', (e) => {
    append('error', [`[unhandledrejection] ${serialize(e.reason)}`]);
  });
}

/** 由 useWebSocket 在 onopen 后调用，把后续日志直发；同时立即 flush 已积压的 */
export function setConsoleBridgeSender(sender: Sender | null): void {
  activeSender = sender;
  // 注册（即 WS 刚 OPEN）时打一条 boot marker，让 backend 端可以用 grep 区分
  // 多次刷新 / 重连产生的会话边界。仅在 sender 非空时打，避免 close 时也打
  if (sender) {
    const ua = navigator.userAgent.split(' ').slice(-3).join(' ');
    // eslint-disable-next-line no-console
    console.log(
      `═══ session boot · ${window.innerWidth}x${window.innerHeight} · ${ua} ═══`,
    );
  }
  tryFlush();
}
