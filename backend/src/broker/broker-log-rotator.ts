/**
 * broker 进程 log 文件按天 rotate（保留 7 天）
 *
 * 0.7.0 v2 起 broker 是长期驻留进程（systemd / detached）；CLI 模式下 stderr
 * 被定向到 service 标准输出 / /dev/null，需要持久化文件做事后排错。
 *
 * 设计：
 *  - 文件命名：`<dataDir>/broker-YYYY-MM-DD.log`
 *  - 切换时机：每天 0 点 + 启动时初始（startedAt 当天文件）
 *  - 写入：append 模式（多次启动同一天的 broker 都写到同一份）
 *  - 旧文件清理：启动 + 每天 0 点扫一遍，删除 mtime > 7 天的 broker-*.log
 *  - 错误处理：rotation 失败仅 warn，不影响 broker 运行
 *
 * 不用 pino-roll：pino-roll 引入额外依赖、需要 worker thread；按天 rotate
 * 这种简单需求自己用 fs 实现更轻、bundle 体积更小。
 */

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  unlinkSync,
} from 'node:fs';
import { resolve, basename } from 'node:path';

/** 保留多少天的旧 log（含今天） */
const KEEP_DAYS = 7;

/** broker log 文件名前缀（用于扫旧文件清理） */
const FILE_PREFIX = 'broker-';
const FILE_SUFFIX = '.log';

export interface BrokerLogRotatorOptions {
  /** log 文件所在目录（如 ~/.auvezy/terminal-remote/） */
  dir: string;
  /** 注入"现在"，便于测试 */
  now?: () => Date;
}

export interface BrokerLogRotator {
  /** 写一行（已带换行）。失败不抛——log 不能阻塞 broker。 */
  write(line: string): void;
  /** 当前日期对应的文件路径 */
  currentFilePath(): string;
  /** 关闭 rotator（清 timer） */
  close(): void;
}

/**
 * 创建按天 rotate 的 log 文件 writer
 *
 * 启动行为：
 *  1. mkdir dir（recursive）
 *  2. 计算 startedAt 当天的文件路径
 *  3. 立即清理 7 天前的旧文件
 *  4. 设置 setTimeout 跨天后切换 + 再清理（之后每 24h 重设）
 */
export function createBrokerLogRotator(
  opts: BrokerLogRotatorOptions,
): BrokerLogRotator {
  const now = opts.now ?? (() => new Date());
  if (!existsSync(opts.dir)) {
    try {
      mkdirSync(opts.dir, { recursive: true, mode: 0o700 });
    } catch {
      /* 目录建失败 → 后续 appendFileSync 也会报错 → 静默 */
    }
  }

  let currentDay = formatDay(now());
  let currentPath = resolve(opts.dir, fileName(currentDay));
  let timer: NodeJS.Timeout | null = null;

  const cleanup = (): void => {
    try {
      const cutoffMs = now().getTime() - KEEP_DAYS * 24 * 60 * 60 * 1000;
      for (const name of readdirSync(opts.dir)) {
        if (!name.startsWith(FILE_PREFIX) || !name.endsWith(FILE_SUFFIX)) continue;
        const full = resolve(opts.dir, name);
        try {
          const st = statSync(full);
          if (st.mtimeMs < cutoffMs) {
            unlinkSync(full);
          }
        } catch {
          /* 单个文件失败忽略 */
        }
      }
    } catch {
      /* readdir 失败忽略 */
    }
  };

  const armTomorrow = (): void => {
    const next = nextMidnight(now());
    const ms = next.getTime() - now().getTime();
    timer = setTimeout(() => {
      currentDay = formatDay(now());
      currentPath = resolve(opts.dir, fileName(currentDay));
      cleanup();
      armTomorrow();
    }, Math.max(1000, ms));
    timer.unref?.();
  };

  cleanup();
  armTomorrow();

  return {
    write(line) {
      // 跨进程同名文件并发追加在 POSIX 上是原子的（< PIPE_BUF），broker
      // 是单进程不会有并发；保留 try/catch 避免临时文件系统错误（如 EROFS）
      // 把 broker 拖进 unhandledRejection
      try {
        appendFileSync(currentPath, line.endsWith('\n') ? line : line + '\n');
      } catch {
        /* 写盘失败 → 忽略（stderr 兜底由 pino transport 处理） */
      }
    },
    currentFilePath() {
      return currentPath;
    },
    close() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
}

/** 'YYYY-MM-DD' */
function formatDay(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function fileName(day: string): string {
  return `${FILE_PREFIX}${day}${FILE_SUFFIX}`;
}

function nextMidnight(now: Date): Date {
  const d = new Date(now);
  d.setHours(24, 0, 0, 0); // setHours(24,...) → 明天 00:00
  return d;
}

/** 给单测用：判断文件名是否符合 broker log 命名 */
export function isBrokerLogFile(name: string): boolean {
  return basename(name).startsWith(FILE_PREFIX) && name.endsWith(FILE_SUFFIX);
}
