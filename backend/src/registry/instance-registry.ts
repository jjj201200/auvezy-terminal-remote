/**
 * instance-registry：跨实例的进程注册表
 *
 * 数据落地：~/.auvezy/terminal-remote/instances.json
 *
 * 设计：
 *  - 文件结构带 version=1，向前兼容
 *  - 所有"读 + 修改 + 写"必须在 mkdir-as-lock 内完成（防并发损坏）
 *  - 注册时先做僵尸清理：扫描 instances[].pid，process.kill(pid, 0) 不存活的剔除
 *  - 写入用 atomicWrite（tmp + rename）避免 partial write
 *  - 新建实例 register/unregister 都返回最新列表，方便调用方直接广播
 *
 * 不直接 import file-lock 整个 module 是为了：
 *  - 单测可以替换 lockDir 为临时目录（已通过 baseDir 注入实现）
 */

import {
  existsSync,
  readFileSync,
  mkdirSync,
} from 'node:fs';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import {
  ATR_DATA_DIR,
  REGISTRY_FILENAME,
  type InstanceInfo,
  type InstanceRegistry,
} from '@auvezy/terminal-remote-shared';
import { withFileLock } from '../utils/file-lock.js';
import { atomicWriteJson } from '../utils/atomic-write.js';
import { logger } from '../logger/logger.js';

/** Manager 构造选项 */
export interface InstanceRegistryOptions {
  /** 注册表文件目录；默认 ~/.auvezy/terminal-remote/ */
  baseDir?: string;
  /** 注册表文件名；默认 'instances.json' */
  filename?: string;
}

/**
 * 进程注册表管理器
 *
 * 一个进程通常只持有一个实例，但 Manager 实例本身可在测试里反复创建。
 */
export class InstanceRegistryManager {
  private readonly baseDir: string;
  private readonly path: string;
  private readonly lockDir: string;

  constructor(opts: InstanceRegistryOptions = {}) {
    this.baseDir = opts.baseDir ?? resolve(homedir(), ATR_DATA_DIR);
    this.path = resolve(this.baseDir, opts.filename ?? REGISTRY_FILENAME);
    this.lockDir = `${this.path}.lock`;
  }

  /**
   * 列出所有"活着"的实例（自动剔除 pid 已死的）
   */
  async list(): Promise<InstanceInfo[]> {
    return withFileLock(this.lockDir, () => {
      const reg = this.readUnlocked();
      const alive = reg.instances.filter((i) => isPidAlive(i.pid));
      // 顺手把僵尸落盘清掉
      if (alive.length !== reg.instances.length) {
        this.writeUnlocked({ version: 1, instances: alive });
      }
      return alive;
    });
  }

  /**
   * 注册新实例（如果 instanceId 已存在则替换 = upsert）
   */
  async register(info: InstanceInfo): Promise<InstanceInfo[]> {
    return withFileLock(this.lockDir, () => {
      const reg = this.readUnlocked();
      const filtered = reg.instances.filter(
        (i) => i.instanceId !== info.instanceId && isPidAlive(i.pid),
      );
      filtered.push(info);
      this.writeUnlocked({ version: 1, instances: filtered });
      logger.info({ instanceId: info.instanceId, port: info.port }, '实例已注册');
      return filtered;
    });
  }

  /**
   * 注销实例（按 instanceId 删除）
   *
   * 进程退出时调用；找不到也不报错。
   */
  async unregister(instanceId: string): Promise<InstanceInfo[]> {
    return withFileLock(this.lockDir, () => {
      const reg = this.readUnlocked();
      const next = reg.instances.filter(
        (i) => i.instanceId !== instanceId && isPidAlive(i.pid),
      );
      this.writeUnlocked({ version: 1, instances: next });
      logger.info({ instanceId }, '实例已注销');
      return next;
    });
  }

  /** 路径暴露给调用方做日志/调试用 */
  get filePath(): string {
    return this.path;
  }

  // ───────── 私有：未加锁的读写（仅在 withFileLock 回调内调用） ─────────

  private readUnlocked(): InstanceRegistry {
    if (!existsSync(this.path)) return { version: 1, instances: [] };
    try {
      const raw = readFileSync(this.path, 'utf-8');
      const parsed = JSON.parse(raw) as InstanceRegistry;
      if (parsed.version !== 1 || !Array.isArray(parsed.instances)) {
        logger.warn({ path: this.path }, '注册表 schema 不识别，重置为空');
        return { version: 1, instances: [] };
      }
      return parsed;
    } catch (err) {
      logger.warn({ path: this.path, err }, '注册表读失败，重置为空');
      return { version: 1, instances: [] };
    }
  }

  private writeUnlocked(reg: InstanceRegistry): void {
    if (!existsSync(this.baseDir)) {
      mkdirSync(this.baseDir, { recursive: true, mode: 0o700 });
    }
    atomicWriteJson(this.path, reg);
  }
}

/**
 * 探活：进程是否仍存活（同一用户作用域）
 *
 * 同 file-lock 的 isStale 检查；提取出来便于复用与单测注入。
 */
export function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  // 当前进程视为"自己"——总是 alive
  if (pid === process.pid) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}
