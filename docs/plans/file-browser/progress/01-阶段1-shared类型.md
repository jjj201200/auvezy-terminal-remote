# 阶段 1 — shared 类型 + ErrorCode + FileError

> 状态:✅ 已完成(2026-05-20)

## 目标

为后续阶段准备类型契约与错误体系。本阶段纯加法,不触碰任何运行时路径。

## 完成项

- 1.1 — 8 个新 ErrorCode 落 `shared/src/errors.ts`(commit 9903742)
- 1.2 — `shared/src/files.ts` 协议类型 + 8 个 type 测试 + 常量(commit 8e46030)
- 1.3 — `backend/src/errors.ts` 加 `FileError` 子类(commit 5842854)

## 实施期发现

- vitest 对纯 `import type` 测试无法可靠"先红后绿":类型擦除让缺失模块的 type-only import 在运行时被忽略。TDD 在 type-only 模块上的有效粒度是"实现后仍绿",这一阶段如此处理。
- shared 包没有独立 `typecheck` 脚本,改用 `pnpm --filter auvezy-terminal-remote-shared build`(`tsc -b`)代替。

## 不做(留下一阶段)

- path-resolver / mime-detect / list-dir 实现(阶段 2)
- 路由挂载(阶段 3)
