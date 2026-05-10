/**
 * 交互式 confirm —— prompts 包薄封装
 *
 * 用途:
 *  - `atr uninstall` 二次确认(防误删 systemd unit)
 *  - `atr kill` 无 pattern 时确认"杀全部"
 *  - PATH 上有同名二进制时,询问 reserved subcommand 还是 PATH binary
 *
 * 非 TTY 行为(stdin 不是 TTY:CI / pipe / nohup):
 *  - 默认采用 `nonInteractiveDefault`(显式传)。让调用方决定:
 *    uninstall 这种"破坏性默认拒"传 false;
 *    `--yes` flag 已经传过的场合可以传 true。
 *  - 这样不会在自动化环境里卡住 stdin。
 *
 * 用户按 Ctrl+C / ESC:prompts 默认返回 undefined → 视作 false(取消)
 */

import prompts from 'prompts';

export interface ConfirmOptions {
  /** 提示文本(末尾不要加问号,prompts 会自动加) */
  message: string;
  /** 默认值(用户直接回车时的选择);prompts 会用 (Y/n) / (y/N) 标识 */
  initial?: boolean;
  /** stdin 不是 TTY 时返回的值 */
  nonInteractiveDefault: boolean;
}

export async function confirm(opts: ConfirmOptions): Promise<boolean> {
  if (!process.stdin.isTTY) return opts.nonInteractiveDefault;

  const r = await prompts(
    {
      type: 'confirm',
      name: 'value',
      message: opts.message,
      initial: opts.initial ?? false,
    },
    {
      // Ctrl+C / ESC → 视作"否",而不是抛异常
      onCancel: () => false,
    },
  );
  return r.value === true;
}

/**
 * 多选一(prompts type: 'select')。用于 PATH 冲突场景:
 *   ? 'start' is both an atr subcommand and a PATH binary at /usr/bin/start. Run which?
 *     ›  atr subcommand (default)
 *        the PATH binary
 *
 * 非 TTY → 返回 nonInteractiveDefault(必须是有效 choice value)
 */
export interface SelectChoice<T extends string> {
  title: string;
  value: T;
  description?: string;
}

export async function selectOne<T extends string>(opts: {
  message: string;
  choices: ReadonlyArray<SelectChoice<T>>;
  nonInteractiveDefault: T;
}): Promise<T> {
  if (!process.stdin.isTTY) return opts.nonInteractiveDefault;
  const r = await prompts(
    {
      type: 'select',
      name: 'value',
      message: opts.message,
      choices: opts.choices.map((ch) => {
        const c: { title: string; value: T; description?: string } = {
          title: ch.title,
          value: ch.value,
        };
        if (ch.description !== undefined) c.description = ch.description;
        return c;
      }),
      initial: 0,
    },
    {
      onCancel: () => opts.nonInteractiveDefault,
    },
  );
  return (r.value ?? opts.nonInteractiveDefault) as T;
}
