/**
 * /api/workdir-policy
 *
 * 只读端点：暴露当前进程"生效后的"workdir 白名单（合并 CLI / env / userConfig 后的最终结果）。
 *
 * 用途：前端创建实例时让用户在白名单里选 base 路径，避免盲填 cwd 被后端拒。
 *
 * 设计：
 *  - 只暴露 allow，不暴露 deny —— 黑名单是"安全防线"，不应该让用户感知存在；
 *    用户白名单选过的路径如果命中 deny，依然由后端拒绝，前端展示后端 reason
 *  - 白名单为空（undefined / []）= 无限制，前端据此显示警告并让用户去配
 */

import { Router, type Request, type Response } from 'express';
import type { AuthModule } from '../auth/auth-middleware.js';

export interface WorkdirPolicySnapshot {
  /** 生效白名单（picomatch glob 列表）；空数组表示用户没设白名单（无限制） */
  readonly allow: readonly string[];
  /**
   * 生效黑名单(picomatch glob 列表)。
   *
   * ⚠️ **严禁通过 /api/workdir-policy 端点或任何公开响应(JSON / 日志 / 错误消息)
   * 暴露此字段** —— 黑名单是安全防线,不应让用户感知存在。本字段仅供 broker
   * 内部其它路由(如 /api/files/*)复用 checkWorkdir 时使用。
   */
  readonly deny: readonly string[];
}

export function createWorkdirPolicyRoutes(
  authModule: AuthModule,
  snapshot: () => WorkdirPolicySnapshot,
): Router {
  const router = Router();
  router.get(
    '/workdir-policy',
    authModule.requireAuth,
    (_req: Request, res: Response) => {
      const s = snapshot();
      res.json({ ok: true, allow: s.allow });
    },
  );
  return router;
}
