/**
 * `atr broker start` CLI runner（0.7.0 阶段 2C）
 *
 * 由 cli.ts 在 subcommand === 'broker' && brokerAction === 'start' 时分发到这里。
 * 阶段 2 内 broker 仅做最小骨架（startBrokerServer 提供的 /api/health），http-proxy
 * 反代要等到阶段 3。
 *
 * 行为：
 *  - 监听 `0.0.0.0:3000`（默认；ATR_BROKER_PORT 可覆盖）
 *  - 写 ~/.atr/broker.json
 *  - SIGINT / SIGTERM 时优雅 shutdown（清 broker.json）
 *  - 阻塞进程直到信号到来
 *
 * 不做（阶段 6）：
 *  - 端口冲突自动递增
 *  - 配置文件读取（broker 自己几乎无配）
 *  - --port / --host CLI flag（先用环境变量，service install 会注入）
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  startBrokerServer,
  DEFAULT_BROKER_PORT,
  DEFAULT_BROKER_HOST,
} from './broker-server.js';
import { logger } from '../logger/logger.js';

/**
 * 启动 broker 进程；不返回（阻塞直到 SIGINT/SIGTERM）
 *
 * @returns 进程退出码（0=正常 / 1=启动失败）
 */
export async function runBrokerCli(): Promise<number> {
  const port = parseEnvPort(process.env['ATR_BROKER_PORT']) ?? DEFAULT_BROKER_PORT;
  const host = process.env['ATR_BROKER_HOST'] ?? DEFAULT_BROKER_HOST;

  // 读取 backend/package.json 拿版本号；本文件位于 backend/dist/broker/cli.js
  // 或 backend/src/broker/cli.ts，向上两级到 package.json
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const pkgPath = resolve(__dirname, '..', '..', 'package.json');
  let brokerVersion = '0.0.0';
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { version?: string };
    if (typeof pkg.version === 'string') brokerVersion = pkg.version;
  } catch (err) {
    logger.warn({ pkgPath, err }, '读取 broker 版本失败，使用 0.0.0 占位');
  }

  let handle;
  try {
    handle = await startBrokerServer({ port, host, brokerVersion });
  } catch (err) {
    process.stderr.write(
      `[atr broker] 启动失败：${err instanceof Error ? err.message : String(err)}\n`,
    );
    return 1;
  }

  process.stderr.write(
    `[atr broker] listening on http://${host}:${handle.port}\n`,
  );

  // 信号处理：优雅 shutdown
  let stopping = false;
  const stop = async (signal: string): Promise<void> => {
    if (stopping) return;
    stopping = true;
    logger.info({ signal }, 'broker 收到退出信号');
    await handle.shutdown();
    process.exit(0);
  };
  process.once('SIGINT', () => void stop('SIGINT'));
  process.once('SIGTERM', () => void stop('SIGTERM'));

  // 阻塞：返回一个永不 resolve 的 Promise；信号到来时上面 stop 会 process.exit
  await new Promise<void>(() => {
    /* never resolves */
  });
  return 0; // unreachable
}

function parseEnvPort(raw: string | undefined): number | null {
  if (!raw) return null;
  const n = Number.parseInt(raw, 10);
  if (!Number.isInteger(n) || n <= 0 || n > 65535) return null;
  return n;
}
