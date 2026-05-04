#!/usr/bin/env node
/**
 * claude-remote CLI 入口
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
  // 阶段 0：最小入口，仅启动空 Express
  // 后续阶段会扩展：参数解析、attach 子命令、配置加载等
  const { startServer } = await import('./index.js');
  await startServer();
})().catch((err: unknown) => {
  // 顶层兜底：任何启动错误都打印到 stderr 并 exit 1
  // 这里不能用 logger（它可能就是出错的源头）
  process.stderr.write(`[claude-remote] 启动失败：${String(err)}\n`);
  if (err instanceof Error && err.stack) {
    process.stderr.write(`${err.stack}\n`);
  }
  process.exit(1);
});
