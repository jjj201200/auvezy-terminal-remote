/**
 * /api/discovery 路由（broker 端）
 *
 * 端点：
 *   GET /api/discovery?instanceId=<id>
 *
 * 扫描实例 cwd 与用户 HOME 下的 claude / codex skills 与 MCP 配置，
 * 返回给前端 DiscoveryModal 列出。鉴权走 authModule.requireAuth。
 *
 * 扫描目录全部为固定名称（.claude / .agents / .codex / .mcp.json），
 * 不接受任意路径参数，无穿越面（见 backend/src/discovery/）。
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import type { DiscoveryResponse } from 'auvezy-terminal-remote-shared';
import type { InstanceRegistryManager } from '../registry/instance-registry.js';
import type { AuthModule } from '../auth/auth-middleware.js';
import { ErrorCode } from 'auvezy-terminal-remote-shared';
import { DiscoveryError, AppError } from '../errors.js';
import { logger } from '../logger/logger.js';
import { scanClaudeSkills, scanCodexSkills } from '../discovery/skills-scanner.js';
import { scanClaudeMcp, scanCodexMcp } from '../discovery/mcp-scanner.js';

export interface DiscoveryRoutesOptions {
  authModule: AuthModule;
  registry: InstanceRegistryManager;
  /** 覆盖用户 HOME（测试注入用；缺省 os.homedir()） */
  homeOverride?: string;
}

export function createDiscoveryRoutes(opts: DiscoveryRoutesOptions): Router {
  const router = Router();
  const { authModule, registry } = opts;
  const home = opts.homeOverride ?? process.env.HOME ?? '';

  router.get('/discovery', authModule.requireAuth, wrap(async (req, res) => {
    const instanceId = req.query.instanceId;
    if (typeof instanceId !== 'string' || instanceId.length === 0) {
      throw new DiscoveryError(ErrorCode.BAD_REQUEST, 'instanceId is required', 400);
    }
    const all = await registry.list();
    const inst = all.find((i) => i.instanceId === instanceId);
    if (!inst) {
      throw new DiscoveryError(
        ErrorCode.INSTANCE_NOT_FOUND, `instance not found: ${instanceId}`, 404,
      );
    }

    // 四路扫描相互独立，任何一路失败在 scanner 内部已降级（warn + 跳过），
    // 不会让整个端点 500
    const [claudeSkills, codexSkills, claudeMcp, codexMcp] = await Promise.all([
      scanClaudeSkills({ home, cwd: inst.cwd }),
      scanCodexSkills({ home, cwd: inst.cwd }),
      scanClaudeMcp({ home, cwd: inst.cwd }),
      scanCodexMcp({ home, cwd: inst.cwd }),
    ]);
    const payload: DiscoveryResponse = {
      ok: true,
      skills: [...claudeSkills, ...codexSkills],
      mcpServers: [...claudeMcp, ...codexMcp],
    };
    logger.info(
      {
        instanceId,
        claudeSkills: claudeSkills.length,
        codexSkills: codexSkills.length,
        claudeMcp: claudeMcp.length,
        codexMcp: codexMcp.length,
      },
      '/api/discovery scanned',
    );
    res.json(payload);
  }));

  return router;
}

type AsyncHandler = (req: Request, res: Response) => Promise<void>;

function wrap(h: AsyncHandler) {
  return async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    try { await h(req, res); }
    catch (err) {
      if (err instanceof AppError) {
        res.status(err.httpStatus).json({
          error: { code: err.code, message: err.message },
        });
        return;
      }
      logger.error({ err }, '/api/discovery unexpected error');
      res.status(500).json({
        error: { code: ErrorCode.INTERNAL_ERROR, message: 'internal error' },
      });
    }
  };
}
