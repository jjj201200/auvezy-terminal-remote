#!/usr/bin/env node
/**
 * copy-frontend-dist
 *
 * 将 frontend/dist 拷贝到 backend/frontend-dist，
 * 让 backend 的 Express 静态文件服务能够直接托管前端产物。
 *
 * 调用时机：
 * - 生产构建：根 package.json 的 build 脚本最后一步
 * - 开发模式：dev 脚本启动前先做一次（确保 backend 找得到目录）
 *
 * 设计动机：
 * - 单一服务进程对外暴露，省去单独跑前端 dev server 的网络复杂度
 * - 静态文件位置稳定（编译产物相对路径），不依赖 cwd
 *
 * 容错：
 * - frontend/dist 不存在时仅打印 warn，不抛错（dev 模式首次启动时常态）
 * - backend/frontend-dist 已存在则先清空再拷贝（避免老文件残留）
 */

import { existsSync, rmSync, cpSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..');

const sourceDir = resolve(projectRoot, 'frontend', 'dist');
const targetDir = resolve(projectRoot, 'backend', 'frontend-dist');

if (!existsSync(sourceDir)) {
  console.warn(`[copy-frontend-dist] 源目录不存在，跳过：${sourceDir}`);
  console.warn('[copy-frontend-dist] 提示：先运行 pnpm --filter @otr/frontend build');
  process.exit(0);
}

if (existsSync(targetDir)) {
  rmSync(targetDir, { recursive: true, force: true });
}

cpSync(sourceDir, targetDir, { recursive: true });
console.log(`[copy-frontend-dist] 已拷贝：${sourceDir} → ${targetDir}`);
