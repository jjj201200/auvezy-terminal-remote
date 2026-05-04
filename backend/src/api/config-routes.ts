/**
 * /api/config 路由
 *
 * 端点：
 *   GET  /config  → 返回当前用户偏好（已 ensureDefaultUserConfig 兜底）
 *   PUT  /config  → 用 body 完整覆盖；返回新值
 *
 * 设计：
 *  - 全部需要鉴权（authModule.requireAuth）
 *  - 状态以"内存对象 = 真相，文件 = 持久化"为准；PUT 时同步写文件并更新内存
 *  - 不做 patch / 字段级合并：客户端读改写后整个 PUT 回来，避免并发冲突
 *
 * 设计选择：把 ConfigStore 接口暴露给路由层而不是直接传 AppConfig，
 *  因为 AppConfig 含 token 等不能 GET 暴露的字段，必须分开。
 */

import { Router, type Request, type Response } from 'express';
import type { UserConfig } from '@ocr/shared';
import { ErrorCode, ensureDefaultUserConfig } from '@ocr/shared';
import type { AuthModule } from '../auth/auth-middleware.js';
import { ConfigError } from '../errors.js';
import { logger } from '../logger/logger.js';

/**
 * 配置存储抽象——index.ts 用具体实现注入；测试可 mock
 */
export interface ConfigStore {
  /** 取当前用户配置 */
  get(): UserConfig;
  /** 用新值整体替换并落盘 */
  set(value: UserConfig): void;
}

export function createConfigRoutes(
  authModule: AuthModule,
  store: ConfigStore,
): Router {
  const router = Router();

  router.get('/config', authModule.requireAuth, (_req: Request, res: Response) => {
    const value = ensureDefaultUserConfig(store.get());
    res.json({ ok: true, config: value });
  });

  router.put('/config', authModule.requireAuth, (req: Request, res: Response) => {
    const body = req.body as unknown;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      const err = new ConfigError(
        ErrorCode.CONFIG_VALIDATION_FAIL,
        'PUT /api/config body 必须是 JSON 对象',
        400,
      );
      res.status(err.httpStatus).json({ error: err.toPayload() });
      return;
    }
    const incoming = body as UserConfig;

    // 字段级简单校验（保护性，深度 schema 校验在阶段 9+ 引入 zod 时再加）
    if (incoming.shortcuts !== undefined && !Array.isArray(incoming.shortcuts)) {
      return rejectFieldType(res, 'shortcuts');
    }
    if (incoming.commands !== undefined && !Array.isArray(incoming.commands)) {
      return rejectFieldType(res, 'commands');
    }
    if (incoming.fontScale !== undefined && typeof incoming.fontScale !== 'number') {
      return rejectFieldType(res, 'fontScale');
    }
    if (
      incoming.vapidPublicKey !== undefined &&
      typeof incoming.vapidPublicKey !== 'string'
    ) {
      return rejectFieldType(res, 'vapidPublicKey');
    }

    try {
      store.set(incoming);
    } catch (err) {
      logger.error({ err }, 'PUT /api/config 写入失败');
      if (err instanceof ConfigError) {
        res.status(err.httpStatus).json({ error: err.toPayload() });
        return;
      }
      const fallback = new ConfigError(
        ErrorCode.CONFIG_WRITE_FAILED,
        '配置写入失败',
        500,
        err,
      );
      res.status(fallback.httpStatus).json({ error: fallback.toPayload() });
      return;
    }

    res.json({ ok: true, config: ensureDefaultUserConfig(store.get()) });
  });

  return router;
}

function rejectFieldType(res: Response, field: string): void {
  const err = new ConfigError(
    ErrorCode.CONFIG_VALIDATION_FAIL,
    `字段 ${field} 类型不正确`,
    400,
  );
  res.status(err.httpStatus).json({ error: err.toPayload() });
}
