#!/usr/bin/env node
/**
 * atr CLI 入口
 *
 * ⚠ 关键约束：本文件不能有任何静态 import 业务模块。
 *
 * 原因：ESM 会把所有 import 提升到模块顶部执行。如果 logger 等模块
 * 在 process.env.CLI_MODE 设置之前被加载，它们顶层读到的环境变量
 * 就是错的（logger 会按非 CLI 模式输出到 stdout，污染 PTY 输出流）。
 *
 * 解决：
 * 1. 顶部仅设置环境变量
 * 2. 所有业务模块通过 await import() 动态加载
 *
 * 唯一允许的静态 import 是 node:* 内置模块（无副作用）。
 */

// ⚠ 第一行：标记 CLI 模式，必须在任何模块加载之前
process.env['CLI_MODE'] = 'true';

void (async () => {
  // 动态 import：保证 CLI_MODE 在 logger 等模块顶层加载前已设
  const { parseCliArgs, HELP_TEXT } = await import('./cli-utils.js');
  const { startServer } = await import('./index.js');
  const { c, disableColors } = await import('./utils/colors.js');

  let cli;
  try {
    cli = parseCliArgs(process.argv.slice(2));
  } catch (err) {
    // 注意:--no-color 此时还没机会生效。但 c.red() 会按 NO_COLOR env 与 TTY
    // 状态自动判断,基本够用;真要在 argument error 上禁色用 NO_COLOR=1。
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`${c.red('[atr]')} argument error: ${msg}\n`);

    // 拼写建议:看 argv 第一个 token,在 subcommand / flag 集合里找最像的。
    // 仅在解析失败时尝试 —— 解析成功的路径不需要这种提示。
    try {
      const { suggest } = await import('./utils/did-you-mean.js');
      const { RESERVED_SUBCOMMANDS, KNOWN_LONG_FLAGS } = await import('./cli-utils.js');
      const first = process.argv.slice(2)[0];
      if (first) {
        const candidates = first.startsWith('--')
          ? KNOWN_LONG_FLAGS
          : Array.from(RESERVED_SUBCOMMANDS);
        const guess = suggest(first, { candidates });
        if (guess) {
          process.stderr.write(`  did you mean: ${c.cyan(guess)}?\n`);
        }
      }
    } catch {
      /* 建议失败不影响主报错 */
    }
    process.exit(2);
  }

  // --no-color 显式优先,从这一刻起所有 c.xxx() 调用一律 plain
  if (cli.noColor) disableColors();

  // 保留 subcommand 与 PATH 二进制冲突时,询问用户走哪条路。
  // 触发条件:
  //   - subcommand 命中 reserved 词(service / kill / attach)
  //   - argv[0] 严格等于该词(否则没冲突可能)
  //   - PATH 上恰好有同名可执行文件
  //   - stdin 是 TTY(非 TTY 静默走 subcommand)
  // 决议:
  //   - subcommand(默认):继续走当前 cli
  //   - PATH binary:把 cli 重写成 PTY 派生模式
  if (
    cli.subcommand !== 'pty' &&
    process.stdin.isTTY
  ) {
    const first = process.argv.slice(2)[0];
    if (first && !first.startsWith('-') && !first.includes('/')) {
      const { resolveExecutable } = await import('./utils/resolve-executable.js');
      const pathBin = resolveExecutable(first);
      if (pathBin) {
        const { selectOne } = await import('./utils/confirm-prompt.js');
        const choice = await selectOne({
          message: `'${first}' is both an atr subcommand and a PATH binary at ${pathBin}. Run which?`,
          choices: [
            { title: `atr ${first} (subcommand)`, value: 'subcommand' as const },
            { title: `${first} (PATH binary at ${pathBin})`, value: 'binary' as const },
          ],
          nonInteractiveDefault: 'subcommand' as const,
        });
        if (choice === 'binary') {
          // 重写为 PTY 派生:用户原意是跑这个二进制
          cli.subcommand = 'pty';
          cli.command = first;
          cli.serviceAction = undefined;
          cli.attachUrl = undefined;
          cli.killPattern = undefined;
          cli.completionShell = undefined;
          // 透传该 token 之后的所有 argv 给子进程
          cli.claudeArgs = process.argv.slice(3);
        }
      }
    }
  }

  if (cli.help) {
    process.stdout.write(HELP_TEXT);
    process.exit(0);
  }
  if (cli.version) {
    // 版本号读 package.json，避免与 build 步骤强耦合
    const { readFileSync } = await import('node:fs');
    const { resolve, dirname } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(
      readFileSync(resolve(__dirname, '..', 'package.json'), 'utf-8'),
    ) as { version: string };
    process.stdout.write(`${pkg.version}\n`);
    process.exit(0);
  }

  // 子命令分发
  //
  // subcommand 枚举（0.7.x）：
  //  - 'pty'        默认；派生 PTY（可能附带先 ensureBroker），落到 startServer
  //  - 'service'    atr start/stop/status/list/install/uninstall/logs，由 broker/cli 处理
  //  - 'attach'     atr attach <url>，CLI 客户端
  //  - 'kill'       atr kill <pattern|all>，停指定实例（旧 atr stop 的语义迁移到这里）
  //  - 'completion' atr completion <shell>，emit 补全脚本
  if (cli.subcommand === 'completion') {
    const shell = cli.completionShell ?? '';
    const { isSupportedCompletionShell, generateCompletionScript, listCompletionShells } =
      await import('./utils/completion-scripts.js');
    if (!isSupportedCompletionShell(shell)) {
      process.stderr.write(
        `${c.red('[atr]')} unsupported shell '${shell}'\n` +
          c.dim(`  supported: ${listCompletionShells().join(', ')}\n`),
      );
      process.exit(2);
    }
    process.stdout.write(generateCompletionScript(shell));
    process.exit(0);
  }

  if (cli.subcommand === 'kill') {
    const { stopInstancesCli } = await import('./registry/cli-stop.js');
    const code = await stopInstancesCli(cli.killPattern);
    process.exit(code);
  }
  if (cli.subcommand === 'attach') {
    if (!cli.attachUrl) {
      process.stderr.write('[atr] attach requires a URL\n');
      process.exit(2);
    }
    const { runAttachCli } = await import('./attach.js');
    const code = await runAttachCli(cli.attachUrl);
    process.exit(code);
  }
  if (cli.subcommand === 'service') {
    if (!cli.serviceAction) {
      process.stderr.write('[atr] missing service action\n');
      process.exit(2);
    }
    const { runServiceCli } = await import('./broker/cli.js');
    const code = await runServiceCli(cli.serviceAction, cli);
    process.exit(code);
  }

  // 默认 'pty'：派生 PTY（startServer 内部会 ensureBroker、resolveExecutable 等）
  await startServer({ cli });
})().catch(async (err: unknown) => {
  // 顶层兜底：任何启动错误都打印到 stderr 并 exit 1
  // 这里不能用 logger（它可能就是出错的源头）
  // 动态 import 避免初始化失败时 colors 模块本身没加载也炸
  let red = (s: string): string => s;
  try {
    const colors = await import('./utils/colors.js');
    red = colors.c.red;
  } catch {
    /* colors 模块加载都坏的极端情况:plain 输出即可 */
  }
  process.stderr.write(`${red('[atr]')} startup failed: ${String(err)}\n`);
  if (err instanceof Error && err.stack) {
    process.stderr.write(`${err.stack}\n`);
  }
  process.exit(1);
});
