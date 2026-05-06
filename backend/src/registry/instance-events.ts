/**
 * instance-events
 *
 * 监听 instances.json 文件变更，把"实例列表变了"事件广播给所有订阅者
 * （SSE 客户端 / 进程内监听）。
 *
 * 设计：
 *  - watch 目录而非文件本身——atomicWriteJson 走 rename，rename 会让 watch 文件
 *    丢 inode；改 watch baseDir + 仅响应 filename 命中事件
 *  - debounce 100ms 合并连续 fs 事件（rename 常触发 2-3 次）
 *  - 错误不抛：watch 失败只记 warn，订阅方仍可手动 GET /api/instances 兜底
 *  - 不在事件 payload 里塞内容；前端 listener 收到事件后自行 GET 拉最新
 *    （单一数据源 = registry.list()，含 isPidAlive 清理）
 */

import { watch, type FSWatcher } from 'node:fs';
import { dirname, basename } from 'node:path';
import { EventEmitter } from 'node:events';
import { logger } from '../logger/logger.js';

const DEBOUNCE_MS = 100;

/** 单例事件总线 */
class InstanceEventBus extends EventEmitter {
  /** 'change' 事件 = 文件变了，订阅方应重读 list */
}

const bus = new InstanceEventBus();
bus.setMaxListeners(0); // 多 SSE 客户端 → 不限上限

let watcher: FSWatcher | null = null;
let debounceTimer: NodeJS.Timeout | null = null;

/**
 * 启动 instances.json 文件 watcher（进程级单例，重复调用安全）
 *
 * @param filePath registry.filePath
 */
export function startInstanceWatcher(filePath: string): void {
  if (watcher) return; // 已启动
  const dir = dirname(filePath);
  const fname = basename(filePath);
  try {
    watcher = watch(dir, (eventType, changedName) => {
      if (changedName !== fname) return;
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        bus.emit('change');
      }, DEBOUNCE_MS);
    });
    watcher.on('error', (err) => {
      logger.warn({ err }, 'instances.json watcher 异常（已停止）');
      watcher = null;
    });
    logger.info({ dir, fname }, 'instances.json watcher 已启动');
  } catch (err) {
    logger.warn({ err, dir }, 'instances.json watch 启动失败（SSE 将无 push，仅靠前端轮询）');
  }
}

/** 停止 watcher（shutdown 用） */
export function stopInstanceWatcher(): void {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  if (watcher) {
    watcher.close();
    watcher = null;
  }
  bus.removeAllListeners();
}

/** 订阅 'change' 事件，返回 unsubscribe 函数 */
export function onInstanceChange(cb: () => void): () => void {
  bus.on('change', cb);
  return () => bus.off('change', cb);
}
