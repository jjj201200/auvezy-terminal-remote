/**
 * InstanceSpawner：派生 headless otr 子进程
 *
 * 用途：前端"创建新实例"按钮 → POST /api/instances → 这里 fork 一个新进程
 *
 * 设计：
 *  - 用 child_process.spawn 拉起 backend 的 cli.js（同一二进制）
 *  - 子进程独立 detached + stdio:'ignore'，让父进程退出后子进程仍存活
 *  - 通过 env 注入 NO_TERMINAL=true、CLAUDE_CWD、INSTANCE_NAME
 *  - 端口由子进程自行 findAvailablePort（不预选避免 TOCTOU）
 *  - 把 spawn 完成视为成功；不等待子进程完全 ready
 *  - 调用方可以再 GET /api/instances 拉新列表确认上线
 *
 * 安全：
 *  - cwd 必须存在且是绝对路径或可解析为绝对路径
 *  - 工作区白名单（WORKSPACE_FORBIDDEN）：阶段 6a 暂未引入，留作 6b 扩展
 */

import { spawn } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { resolve, isAbsolute } from 'node:path';
import { ErrorCode } from '@otr/shared';
import { InstanceError } from '../errors.js';
import { logger } from '../logger/logger.js';

export interface SpawnInstanceInput {
  /** 工作目录（绝对路径，必须已存在） */
  cwd: string;
  /** 实例显示名（默认 cwd 末段） */
  name?: string;
}

export interface SpawnInstanceResult {
  /** 子进程 PID */
  pid: number;
  /** 解析后的 cwd */
  cwd: string;
  /** 实例显示名 */
  name: string;
}

/** Spawner 接口（路由层依赖此接口而非具体实现，便于单测） */
export interface InstanceSpawner {
  spawn(input: SpawnInstanceInput): Promise<SpawnInstanceResult>;
}

/** Spawner 构造选项 */
export interface DefaultInstanceSpawnerOptions {
  /** cli.js 路径（默认从当前 module 解析到 backend/dist/cli.js） */
  cliJsPath: string;
  /** 透传给子进程的额外环境（如 HOME 重定向，主要用于测试） */
  env?: NodeJS.ProcessEnv;
}

/**
 * 默认实现：用 child_process.spawn 起新进程
 */
export class DefaultInstanceSpawner implements InstanceSpawner {
  constructor(private readonly opts: DefaultInstanceSpawnerOptions) {}

  async spawn(input: SpawnInstanceInput): Promise<SpawnInstanceResult> {
    const cwd = isAbsolute(input.cwd) ? input.cwd : resolve(input.cwd);

    if (!existsSync(cwd)) {
      throw new InstanceError(ErrorCode.CWD_NOT_EXIST, `工作目录不存在：${cwd}`, 400);
    }
    if (!statSync(cwd).isDirectory()) {
      throw new InstanceError(ErrorCode.CWD_NOT_EXIST, `cwd 不是目录：${cwd}`, 400);
    }

    const name = input.name && input.name.trim() ? input.name.trim() : basename(cwd);

    const child = spawn(
      process.execPath,
      [this.opts.cliJsPath, '--no-terminal'],
      {
        cwd,
        env: {
          ...process.env,
          ...this.opts.env,
          INSTANCE_NAME: name,
          // 不重置 HOME，让子进程读同一个 ~/.open-terminal-remote/config.json（共享 token）
        },
        detached: true,
        stdio: 'ignore',
      },
    );
    // 让父进程退出不杀子进程
    child.unref();

    if (typeof child.pid !== 'number') {
      throw new InstanceError(
        ErrorCode.INTERNAL_ERROR,
        '子进程 spawn 失败：无 pid',
        500,
      );
    }

    logger.info({ pid: child.pid, cwd, name }, '已派生 headless 实例');
    return { pid: child.pid, cwd, name };
  }
}

/** path.basename 包一层兜底空字符串 */
function basename(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? 'instance';
}
