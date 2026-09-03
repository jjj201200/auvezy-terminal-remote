/**
 * InstanceSpawner：派生 headless atr 子进程
 *
 * 用途：前端"创建新实例"按钮 → POST /api/instances → 这里 fork 一个新进程
 *
 * 设计：
 *  - 用 child_process.spawn 拉起 backend 的 cli.js（同一二进制）
 *  - 子进程独立 detached + stdio:'ignore'，让父进程退出后子进程仍存活
 *  - 通过 spawn 选项 cwd 设置工作目录；仅显式命名时 env 注入 INSTANCE_NAME
 *    （未命名由子进程 basename fallback + register 自动避让，见 instance-name.ts）
 *  - 端口由子进程自行 findAvailablePort（不预选避免 TOCTOU）
 *  - 把 spawn 完成视为成功；不等待子进程完全 ready
 *  - 调用方可以再 GET /api/instances 拉新列表确认上线
 *
 * 安全：
 *  - cwd 必须存在且是绝对路径或可解析为绝对路径
 *  - 工作区白名单（WORKSPACE_FORBIDDEN）：阶段 6a 暂未引入，留作 6b 扩展
 */

import { spawn } from 'node:child_process';
import { existsSync, statSync, openSync } from 'node:fs';
import { resolve, isAbsolute, dirname } from 'node:path';
import { ErrorCode } from 'auvezy-terminal-remote-shared';
import { InstanceError } from '../errors.js';
import { logger } from '../logger/logger.js';
import { checkWorkdir } from '../utils/workdir-policy.js';

export interface SpawnInstanceInput {
  /** 工作目录（绝对路径，必须已存在） */
  cwd: string;
  /** 实例显示名（默认 cwd 末段） */
  name?: string;
  /**
   * 调用方预生成的 instanceId（0.7.0 起 broker 在 POST /api/instances 时
   * 生成 UUID 通过 env `ATR_INSTANCE_ID` 透传，让 webapp 立刻拿到 id 能
   * 订阅 SSE 等就绪）。不传时由子进程自己 randomUUID。
   */
  instanceId?: string;
}

export interface SpawnInstanceResult {
  /** 子进程 PID */
  pid: number;
  /** 解析后的 cwd */
  cwd: string;
  /** 实例显示名 */
  name: string;
  /** 透传给子进程的 instanceId（即输入 instanceId；未传则 undefined） */
  instanceId?: string;
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
  /**
   * Workdir 白名单 picomatch 模式列表。空 / undefined = 不限制。
   * 由 AppConfig 传入；CLI > env > userConfig 的合并已在 loadConfig 完成。
   */
  workdirAllow?: readonly string[];
  /**
   * Workdir 黑名单 picomatch 模式列表。命中即拒绝。
   * 默认值（包含 /etc/** 等敏感路径）由 ensureDefaultUserConfig 兜底。
   */
  workdirDeny?: readonly string[];
}

/**
 * 默认实现：用 child_process.spawn 起新进程
 */
export class DefaultInstanceSpawner implements InstanceSpawner {
  constructor(private readonly opts: DefaultInstanceSpawnerOptions) {}

  async spawn(input: SpawnInstanceInput): Promise<SpawnInstanceResult> {
    const cwd = isAbsolute(input.cwd) ? input.cwd : resolve(input.cwd);

    if (!existsSync(cwd)) {
      throw new InstanceError(ErrorCode.CWD_NOT_EXIST, `cwd does not exist: ${cwd}`, 400);
    }
    if (!statSync(cwd).isDirectory()) {
      throw new InstanceError(ErrorCode.CWD_NOT_EXIST, `cwd is not a directory: ${cwd}`, 400);
    }

    // 白/黑名单校验：先黑后白，命中则拒绝
    const verdict = checkWorkdir(cwd, this.opts.workdirAllow, this.opts.workdirDeny);
    if (verdict !== null) {
      logger.warn({ cwd, verdict }, 'workdir policy rejected spawn');
      throw new InstanceError(
        ErrorCode.CWD_NOT_EXIST,
        `cwd not allowed by workdir policy: ${verdict.reason}`,
        403,
      );
    }

    // 命名语义：显式名（web 表单填写）才透传 INSTANCE_NAME，子进程 register
    // 时原样写入（重名已由 POST /api/instances 的 409 两段式把关）；未显式
    // 命名则不注入 env，子进程走 basename fallback + register 锁内自动避让
    // （并发创建的同 cwd 实例必然得到不同序号）。
    // 返回值的 name 仅用于 API 202 响应的"建议名"——未命名时是 basename，
    // 实际最终名（可能带 -N 序号）以子进程注册后的 GET /api/instances 为准。
    const explicitName = input.name?.trim() || undefined;

    // 解析子进程入口：
    // 1) 若 cliJsPath 直接存在 → 用 node 跑（生产态：dist/cli.js）
    // 2) 否则尝试同目录的 cli.ts → 用 tsx 跑（开发态：src/cli.ts）
    // dev 态 spawner 注入的是 src/cli.js，文件不存在导致子进程瞬间死亡且 stdio:ignore 吞掉错误
    const { execPath, args: entryArgs } = resolveEntry(this.opts.cliJsPath);

    // 子进程日志重定向到 /tmp/atr-spawn-*.log，便于排查派生失败
    // 默认是 ignore（生产态稳定后无需占盘），但 ATR_DEBUG_SPAWN=1 时启用
    const logFd = process.env.ATR_DEBUG_SPAWN
      ? openSync(`/tmp/atr-spawn-${Date.now()}.log`, 'a')
      : 'ignore';

    const child = spawn(
      execPath,
      [...entryArgs, '--no-terminal'],
      {
        cwd,
        env: {
          ...process.env,
          ...this.opts.env,
          ...(explicitName ? { INSTANCE_NAME: explicitName } : {}),
          // 0.7.0：broker 预生成 instanceId 透传给 worker，让 webapp 立刻能
          // 用同一个 id 订阅 SSE / 拼 /i/<id>/ws；worker 启动时优先读这个
          // env，没有才 randomUUID()
          ...(input.instanceId ? { ATR_INSTANCE_ID: input.instanceId } : {}),
          // 不重置 HOME，让子进程读同一个 ~/.atrrc（共享 token）
        },
        detached: true,
        stdio: ['ignore', logFd, logFd],
      },
    );
    // 让父进程退出不杀子进程
    child.unref();

    if (typeof child.pid !== 'number') {
      throw new InstanceError(
        ErrorCode.INTERNAL_ERROR,
        'spawn failed: no pid',
        500,
      );
    }

    // 等 600ms 看子进程是否瞬间死亡（路径错 / 端口冲突 / 依赖缺失等）
    // 死了就直接报错，不让前端误以为创建成功
    const earlyExit = await waitForEarlyExit(child, 600);
    if (earlyExit !== null) {
      throw new InstanceError(
        ErrorCode.INTERNAL_ERROR,
        `child exited immediately (exit=${earlyExit.code} signal=${earlyExit.signal}). ` +
          'Common causes: missing cli entry, port conflict, incomplete node_modules. ' +
          'Set ATR_DEBUG_SPAWN=1 and restart to capture /tmp/atr-spawn-*.log.',
        500,
      );
    }

    logger.info(
      {
        pid: child.pid,
        cwd,
        name: explicitName ?? basename(cwd),
        instanceId: input.instanceId,
        exec: execPath,
        args: entryArgs,
      },
      'spawned headless instance',
    );
    return {
      pid: child.pid,
      cwd,
      name: explicitName ?? basename(cwd),
      ...(input.instanceId ? { instanceId: input.instanceId } : {}),
    };
  }
}

/**
 * 等子进程在 timeout ms 内是否退出。
 * - 退出：返回 { code, signal }
 * - 没退出（仍在跑）：返回 null
 */
function waitForEarlyExit(
  child: import('node:child_process').ChildProcess,
  timeoutMs: number,
): Promise<{ code: number | null; signal: NodeJS.Signals | null } | null> {
  return new Promise((res) => {
    let settled = false;
    const onExit = (code: number | null, signal: NodeJS.Signals | null): void => {
      if (settled) return;
      settled = true;
      res({ code, signal });
    };
    child.once('exit', onExit);
    setTimeout(() => {
      if (settled) return;
      settled = true;
      child.off('exit', onExit);
      res(null);
    }, timeoutMs);
  });
}

/**
 * 解析子进程入口：
 * - dist/cli.js 存在（生产）→ node + cli.js
 * - src/cli.ts 存在（开发）→ tsx + cli.ts（找 backend/node_modules/.bin/tsx）
 *
 * dev 态 spawner 默认拿到的 cliJsPath 是 src/cli.js（不存在），
 * 旧实现直接 spawn 不存在的文件 + stdio:'ignore' → 子进程瞬间死亡且无任何报错。
 */
function resolveEntry(cliJsPath: string): { execPath: string; args: string[] } {
  if (existsSync(cliJsPath)) {
    return { execPath: process.execPath, args: [cliJsPath] };
  }
  const tsPath = cliJsPath.replace(/\.js$/, '.ts');
  if (existsSync(tsPath)) {
    // 向上找最近的 node_modules/.bin/tsx
    const tsxBin = findTsxBin(dirname(tsPath));
    if (tsxBin) {
      return { execPath: tsxBin, args: [tsPath] };
    }
    // tsx 未装：尝试 node --import tsx（node >= 20.6）
    return {
      execPath: process.execPath,
      args: ['--import', 'tsx', tsPath],
    };
  }
  throw new InstanceError(
    ErrorCode.INTERNAL_ERROR,
    `child entry not found: ${cliJsPath} or ${tsPath}`,
    500,
  );
}

function findTsxBin(startDir: string): string | null {
  let dir = startDir;
  for (let i = 0; i < 10; i++) {
    const candidate = resolve(dir, 'node_modules', '.bin', 'tsx');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/** path.basename 包一层兜底空字符串 */
function basename(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? 'instance';
}
