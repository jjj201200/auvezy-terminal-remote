/**
 * `atr list`：列出当前用户所有活实例
 *
 * 输出到 stdout 的简表（不依赖颜色）：
 *   PORT   PID    INSTANCE NAME                  CWD
 *   3000   1234   my-project                     /home/me/code/foo
 *
 * 退出码：0 始终（即便 0 个实例也算成功）
 */

import { InstanceRegistryManager } from './instance-registry.js';
import { c } from '../utils/colors.js';

export async function listInstancesCli(): Promise<number> {
  const registry = new InstanceRegistryManager();
  const list = await registry.list();
  if (list.length === 0) {
    process.stdout.write(c.dim('no running instances\n'));
    return 0;
  }

  const header = ['PORT', 'PID', 'INSTANCE NAME', 'CWD'];
  const rows = list.map((i) => [
    String(i.port),
    String(i.pid),
    i.name.slice(0, 30),
    i.cwd,
  ]);

  // 列宽:基于"未上色的字符串长度"计算,避免上色后 ANSI 码污染对齐
  const widths = header.map((h, idx) =>
    Math.max(h.length, ...rows.map((r) => r[idx]!.length)),
  );

  const printRow = (cells: string[], decorate?: (s: string) => string): void => {
    const line = cells
      .map((cell, i) => {
        const padded = cell.padEnd(widths[i]!);
        return decorate ? decorate(padded) : padded;
      })
      .join('  ');
    process.stdout.write(line + '\n');
  };

  printRow(header, c.bold);
  printRow(widths.map((w) => '-'.repeat(w)), c.dim);
  for (const r of rows) printRow(r);
  return 0;
}
