/**
 * broker.json 状态文件读写 + 健康判定（0.7.0）
 *
 * 设计目标（详见 ADR-002）：
 *  - 文件位置：`~/.atr/broker.json`
 *  - 用途：worker 启动时检查 broker 是否已在跑——若没有则 fork 一个；
 *    `atr broker status` 等 CLI 用此文件回答"broker 现在到底在哪儿"
 *  - **不存日志路径 / token 等敏感字段**：仅 pid / port / host / startedAt / version，
 *    其它信息走标准 systemd / launchd 日志或 broker 自己的 logger
 *
 * 存活判定（isBrokerAlive）：
 *  - 必要条件 1：broker.json 存在且解析成功
 *  - 必要条件 2：pid 用 `process.kill(pid, 0)` 探活成功（同用户、同主机）
 *  - 可选加强：HTTP 探针 `GET http://<host>:<port>/api/health`（需要调用方传 fetch
 *    并 await）。HTTP 探针仅在 ensure 流程中跑一次，validate / status 不需要。
 *
 * 与 file-lock 的关系：
 *  - **不在本模块内做 file-lock**——状态写在 ensure 流程的锁内（见 ADR-002 §决策第 1 步），
 *    本模块仅提供原子读 / 原子写两个原语。
 *
 * 错误策略：
 *  - 读：损坏 / 缺失 → 返回 null（视作"broker 没启过"），不抛
 *  - 写：mkdir / atomicWrite 失败 → 抛 ConfigError(CONFIG_WRITE_FAILED)
 */

import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { homedir } from 'node:os';
import { ATR_DATA_DIR, ErrorCode } from 'auvezy-terminal-remote-shared';
import { atomicWriteJson } from '../utils/atomic-write.js';
import { ConfigError } from '../errors.js';
import { logger } from '../logger/logger.js';

/** broker.json schema version */
const SCHEMA_VERSION = 1;

const BROKER_STATE_FILENAME = 'broker.json';

/** broker 在 ~/.atr/broker.json 中持久化的运行时状态 */
export interface BrokerState {
  version: 1;
  /** broker 进程 PID（用于探活） */
  pid: number;
  /** broker 监听端口 */
  port: number;
  /** broker 监听 host（默认 0.0.0.0；展示用，不参与探活） */
  host: string;
  /** broker 启动时间戳（ms） */
  startedAt: number;
  /** broker 进程的 atr 版本（package.json 的 version；用于诊断版本错位） */
  brokerVersion: string;
}

/** 默认 broker.json 路径 */
export function defaultBrokerStatePath(): string {
  return resolve(homedir(), ATR_DATA_DIR, BROKER_STATE_FILENAME);
}

/**
 * 读 broker.json
 *
 * @param path 自定义路径（测试 / 替代位置）；默认 `~/.atr/broker.json`
 * @returns BrokerState；不存在 / 损坏 → null
 */
export function readBrokerState(path: string = defaultBrokerStatePath()): BrokerState | null {
  if (!existsSync(path)) return null;
  let raw: string;
  try {
    raw = readFileSync(path, 'utf-8');
  } catch (err) {
    logger.warn({ path, err }, '读 broker.json 失败，按未启动处理');
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    logger.warn({ path, err }, 'broker.json JSON 解析失败，按未启动处理');
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const obj = parsed as Record<string, unknown>;
  if (obj['version'] !== SCHEMA_VERSION) {
    logger.warn(
      { path, version: obj['version'] },
      'broker.json schema 版本不识别，按未启动处理',
    );
    return null;
  }

  const pid = num(obj['pid']);
  const port = num(obj['port']);
  const host = str(obj['host']);
  const startedAt = num(obj['startedAt']);
  const brokerVersion = str(obj['brokerVersion']);
  if (pid === null || port === null || host === null || startedAt === null || brokerVersion === null) {
    logger.warn({ path }, 'broker.json 字段缺失，按未启动处理');
    return null;
  }
  return { version: SCHEMA_VERSION, pid, port, host, startedAt, brokerVersion };
}

/**
 * 写 broker.json（原子）
 *
 * 调用方需自行持锁（ensure 流程内），本函数不做并发保护。
 */
export function writeBrokerState(
  state: Omit<BrokerState, 'version'>,
  path: string = defaultBrokerStatePath(),
): void {
  const dir = dirname(path);
  if (!existsSync(dir)) {
    try {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
    } catch (err) {
      throw new ConfigError(
        ErrorCode.CONFIG_WRITE_FAILED,
        `创建 broker 数据目录失败：${dir}`,
        500,
        err,
      );
    }
  }
  try {
    atomicWriteJson(path, { version: SCHEMA_VERSION, ...state }, 0o600);
  } catch (err) {
    throw new ConfigError(
      ErrorCode.CONFIG_WRITE_FAILED,
      `写 broker.json 失败：${path}`,
      500,
      err,
    );
  }
}

/**
 * 删除 broker.json
 *
 * broker 优雅退出 / `atr broker stop` 时调用；不存在不报错。
 */
export function clearBrokerState(path: string = defaultBrokerStatePath()): void {
  try {
    rmSync(path, { force: true });
  } catch (err) {
    logger.warn({ path, err }, '删除 broker.json 失败（忽略）');
  }
}

/**
 * 判断 broker 是否仍存活
 *
 * 算法：
 *  1. broker.json 不存在 → 未启动
 *  2. pid 用 `process.kill(pid, 0)` 探活
 *     - 成功（无异常）→ 进程存在 → 存活
 *     - ESRCH → 进程不存在 → 死了
 *     - EPERM → 进程存在但当前用户无权 signal（异常场景：跨用户共享 ~/.atr？
 *       atr 单用户使用，此处保守判存活，避免误删别用户的 broker.json）
 *
 * @returns true=活；false=死或不存在
 */
export function isBrokerAlive(state: BrokerState | null): boolean {
  if (!state) return false;
  try {
    process.kill(state.pid, 0);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ESRCH') return false; // 进程不存在
    if (code === 'EPERM') return true; // 没权限 signal，但进程存在
    // 其它异常（极罕见）：保守判死
    logger.warn({ pid: state.pid, err }, 'broker 探活异常，判作未存活');
    return false;
  }
}

// ──────────────── 内部解析辅助 ────────────────

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}
