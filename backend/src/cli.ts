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

  let cli;
  try {
    cli = parseCliArgs(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(
      `[atr] argument error: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(2);
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
  if (cli.subcommand === 'stop') {
    const { stopInstancesCli } = await import('./registry/cli-stop.js');
    const code = await stopInstancesCli(cli.stopPattern);
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
  // 服务级动作（顶层 flag 触发）：管 broker、列实例、装卸自启
  if (cli.subcommand === 'service') {
    if (!cli.serviceAction) {
      process.stderr.write('[atr] missing service action\n');
      process.exit(2);
    }
    const { runServiceCli } = await import('./broker/cli.js');
    const code = await runServiceCli(cli.serviceAction);
    process.exit(code);
  }

  await startServer({ cli });
})().catch((err: unknown) => {
  // 顶层兜底：任何启动错误都打印到 stderr 并 exit 1
  // 这里不能用 logger（它可能就是出错的源头）
  process.stderr.write(`[atr] startup failed: ${String(err)}\n`);
  if (err instanceof Error && err.stack) {
    process.stderr.write(`${err.stack}\n`);
  }
  process.exit(1);
});
