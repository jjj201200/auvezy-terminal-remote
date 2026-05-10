/**
 * `atr kill <pattern | 'all'>`：把匹配的实例停掉
 *
 * （0.7.x 起从 `atr stop <pattern>` 迁移到 `atr kill <pattern>`，让 `atr stop`
 * 单纯表示"停 broker 服务"。文件名 cli-stop.ts 暂未跟着改，留作历史标记。）
 *
 * 0.7.x 起 pattern 必填:不允许"裸 atr kill"误杀全部;要杀全部必须显式 `all`。
 *
 * 输出每个目标的处理结果，最后总结杀掉个数。
 * 退出码：
 *   0 = 至少处理了一个 / 用户取消(cancelled)
 *   1 = 没匹配到
 *   2 = 缺 pattern / 内部错误
 */

import { stopInstances } from './stop-instances.js';
import { InstanceRegistryManager } from './instance-registry.js';
import { c } from '../utils/colors.js';
import { confirm } from '../utils/confirm-prompt.js';

/**
 * `atr kill <pattern | 'all'>` 入口。
 *
 * 语义:
 *  - 不传 pattern:报错提示用户必须显式给一个 pattern 或 `all`,避免误杀全部。
 *  - `all`:确认后杀全部(过去的"无 pattern = 全部"语义改成必须显式 `all`)。
 *  - 其它:按 substring 匹配 instance.name / cwd / host:port。
 */
export async function stopInstancesCli(pattern?: string): Promise<number> {
  try {
    // 缺 pattern → 用户教育路径:不允许"裸 atr kill"杀全部
    if (pattern === undefined || pattern === '') {
      process.stderr.write(
        `${c.red('[atr]')} kill requires a pattern (or 'all' to kill every instance)\n` +
          c.dim(
            "  e.g. atr kill myproj    # match by name/cwd/host:port\n" +
              "       atr kill all       # kill every running instance\n",
          ),
      );
      return 2;
    }

    // `atr kill all` → 显式杀全部,加二次确认
    // 非 TTY:nonInteractiveDefault=true(脚本里跑 atr kill all 表示自动化清理)
    let effectivePattern: string | undefined = pattern;
    if (pattern === 'all') {
      const allInstances = await new InstanceRegistryManager().list();
      if (allInstances.length === 0) {
        process.stdout.write(`${c.dim('no running instances')}\n`);
        return 0;
      }
      const ok = await confirm({
        message: `Kill all ${allInstances.length} running instance(s)?`,
        initial: false,
        nonInteractiveDefault: true,
      });
      if (!ok) {
        process.stdout.write(`${c.dim('[atr] kill cancelled')}\n`);
        return 0;
      }
      // 转给 stopInstances:undefined 即"全部"
      effectivePattern = undefined;
    }

    const results = await stopInstances(effectivePattern);
    if (results.length === 0) {
      const hint = pattern ? ` (pattern="${pattern}")` : '';
      process.stdout.write(`${c.yellow('no matching instances')}${hint}\n`);
      return 1;
    }
    for (const r of results) {
      // 对每种 outcome 用统一的 4 字符标签 + 配色,保持表格对齐
      const tag =
        r.outcome === 'sigterm'
          ? c.green('OK  ')
          : r.outcome === 'sigkill'
            ? c.yellow('KILL')
            : r.outcome === 'gone'
              ? c.dim('GONE')
              : c.red('FAIL');
      process.stdout.write(
        `${tag}  port=${r.instance.port}  pid=${r.instance.pid}  name=${r.instance.name}` +
          (r.error ? `  err=${r.error}` : '') +
          '\n',
      );
    }
    return 0;
  } catch (err) {
    process.stderr.write(
      `${c.red('[atr]')} stop failed: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return 2;
  }
}
