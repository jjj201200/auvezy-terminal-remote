/**
 * stop-instances：CLI `otr stop [pattern]` 子命令的核心逻辑
 *
 * 设计：
 *  - 从 InstanceRegistryManager 拉列表，按 pattern 过滤
 *  - 对每个目标：SIGTERM → 等待最多 STOP_INSTANCE_GRACE_MS → 仍存活则 SIGKILL
 *  - 注销实例条目（即使进程已不可控也清掉 stale 记录）
 *  - 不抛错：找不到目标也算"成功"，只在结果里报告 0 stopped
 *
 * pattern 匹配规则：
 *  - undefined / 空字符串 → 全部
 *  - 否则按 substring 匹配 instance.name 或 instance.cwd 或 'host:port'
 *
 * 输出：StopResult 数组（每个实例一项）
 */

import {
  InstanceRegistryManager,
  isPidAlive,
} from './instance-registry.js';
import type { InstanceInfo } from '@otr/shared';
import { logger } from '../logger/logger.js';
import {
  STOP_INSTANCE_GRACE_MS,
  STOP_INSTANCE_POLL_INTERVAL_MS,
} from '../constants.js';

export interface StopResult {
  instance: InstanceInfo;
  /** 'sigterm'：SIGTERM 后正常退出；'sigkill'：宽限期后强杀；'gone'：探活时已不存在 */
  outcome: 'sigterm' | 'sigkill' | 'gone' | 'failed';
  /** 失败时的错误 message */
  error?: string;
}

export interface StopInstancesOptions {
  /** 自定义 registry（测试注入） */
  registry?: InstanceRegistryManager;
  /** 等待优雅退出的时长（ms），默认 STOP_INSTANCE_GRACE_MS */
  graceMs?: number;
  /** 进程探活轮询间隔，默认 STOP_INSTANCE_POLL_INTERVAL_MS */
  pollIntervalMs?: number;
  /** kill 注入便于单测 */
  killImpl?: (pid: number, signal: NodeJS.Signals) => void;
}

/**
 * 停止匹配 pattern 的实例
 *
 * @param pattern undefined / '' = 全部；其它按 substring 匹配
 * @param opts    测试可注入 registry / kill / 时长
 */
export async function stopInstances(
  pattern: string | undefined,
  opts: StopInstancesOptions = {},
): Promise<StopResult[]> {
  const registry = opts.registry ?? new InstanceRegistryManager();
  const graceMs = opts.graceMs ?? STOP_INSTANCE_GRACE_MS;
  const pollMs = opts.pollIntervalMs ?? STOP_INSTANCE_POLL_INTERVAL_MS;
  const kill = opts.killImpl ?? defaultKill;

  const all = await registry.list();
  const targets = filterByPattern(all, pattern);

  const results: StopResult[] = [];
  for (const inst of targets) {
    const r = await stopOne(inst, kill, graceMs, pollMs);
    results.push(r);
    // 不论结果如何，都把记录从注册表移除
    try {
      await registry.unregister(inst.instanceId);
    } catch (err) {
      logger.warn({ err, instanceId: inst.instanceId }, '注销失败（忽略）');
    }
  }

  return results;
}

function filterByPattern(all: InstanceInfo[], pattern?: string): InstanceInfo[] {
  if (!pattern || pattern.length === 0) return all;
  const p = pattern.toLowerCase();
  return all.filter((i) => {
    const fields = [i.name, i.cwd, `${i.host}:${i.port}`].map((s) => s.toLowerCase());
    return fields.some((s) => s.includes(p));
  });
}

async function stopOne(
  inst: InstanceInfo,
  kill: (pid: number, signal: NodeJS.Signals) => void,
  graceMs: number,
  pollMs: number,
): Promise<StopResult> {
  if (!isPidAlive(inst.pid)) {
    return { instance: inst, outcome: 'gone' };
  }

  // SIGTERM
  try {
    kill(inst.pid, 'SIGTERM');
  } catch (err) {
    return {
      instance: inst,
      outcome: 'failed',
      error: (err as Error).message,
    };
  }

  // 轮询是否退出
  const deadline = Date.now() + graceMs;
  while (Date.now() < deadline) {
    if (!isPidAlive(inst.pid)) {
      return { instance: inst, outcome: 'sigterm' };
    }
    await sleep(pollMs);
  }

  // 仍存活 → SIGKILL
  try {
    kill(inst.pid, 'SIGKILL');
  } catch {
    // 可能恰在 SIGTERM 后退出导致 ESRCH，视为成功
    return { instance: inst, outcome: 'sigterm' };
  }
  // 给一点时间让内核回收
  await sleep(pollMs * 2);
  return { instance: inst, outcome: 'sigkill' };
}

function defaultKill(pid: number, signal: NodeJS.Signals): void {
  process.kill(pid, signal);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
