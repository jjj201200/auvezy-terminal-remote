/**
 * `atr stop [pattern]`：把匹配的实例停掉
 *
 * 输出每个目标的处理结果，最后总结杀掉个数。
 * 退出码：
 *   0 = 至少处理了一个
 *   1 = 没匹配到
 *   2 = 内部错误
 */

import { stopInstances } from './stop-instances.js';

export async function stopInstancesCli(pattern?: string): Promise<number> {
  try {
    const results = await stopInstances(pattern);
    if (results.length === 0) {
      const hint = pattern ? ` (pattern="${pattern}")` : '';
      process.stdout.write(`no matching instances${hint}\n`);
      return 1;
    }
    for (const r of results) {
      const tag =
        r.outcome === 'sigterm'
          ? 'OK '
          : r.outcome === 'sigkill'
            ? 'KILL'
            : r.outcome === 'gone'
              ? 'GONE'
              : 'FAIL';
      process.stdout.write(
        `${tag}  port=${r.instance.port}  pid=${r.instance.pid}  name=${r.instance.name}` +
          (r.error ? `  err=${r.error}` : '') +
          '\n',
      );
    }
    return 0;
  } catch (err) {
    process.stderr.write(
      `[atr] stop failed: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return 2;
  }
}
