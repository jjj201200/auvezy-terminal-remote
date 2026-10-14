/**
 * /api/integrations/codex/trust 路由(broker 端)
 *
 * Codex hook 一键授权(用户显式授权动作,不是静默绕过):
 *   GET  ?instanceId= → 当前授权状态(前端横幅显隐)
 *   POST { instanceId } → 把镜像 hooks.json 全部事件的 trusted_hash 写进
 *                         真实 ~/.codex/config.toml(重启 codex 后生效)
 *
 * 鉴权走 authModule.requireAuth。路径推导只读固定位置(镜像目录由实例 cwd
 * 派生),无用户可控路径。
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { ATR_DATA_DIR, ErrorCode } from 'auvezy-terminal-remote-shared';
import type { InstanceRegistryManager } from '../registry/instance-registry.js';
import type { AuthModule } from '../auth/auth-middleware.js';
import { DiscoveryError, AppError } from '../errors.js';
import { logger } from '../logger/logger.js';
import { codexMirrorDirPath } from '../integrations/codex/codex-home-mirror.js';
import {
  grantCodexTrust,
  hooksJsonExists,
  readCodexTrustStatus,
} from '../integrations/codex/trust.js';

export interface CodexTrustRoutesOptions {
  authModule: AuthModule;
  registry: InstanceRegistryManager;
  /** 覆盖用户 HOME(测试注入;缺省 os.homedir()) */
  homeOverride?: string;
}

/** 汇总响应体 */
interface CodexTrustResponse {
  ok: true;
  /** trusted = 全部事件哈希匹配;untrusted = 需(重新)授权 */
  status: 'trusted' | 'untrusted';
  matched: number;
  total: number;
  /** 实例对应镜像 hooks.json 是否已生成(未跑过 codex 时 false) */
  mirrorReady: boolean;
}

export function createCodexTrustRoutes(opts: CodexTrustRoutesOptions): Router {
  const router = Router();
  const { authModule, registry } = opts;
  const home = opts.homeOverride ?? homedir();
  const mirrorBase = resolve(home, ATR_DATA_DIR, 'codex');
  const userConfigToml = resolve(home, '.codex', 'config.toml');

  /** 解析 instanceId → cwd + 镜像 hooks.json 路径;失败抛 DiscoveryError */
  async function resolveContext(
    req: Request,
  ): Promise<{ instanceId: string; cwd: string; hooksJsonPath: string }> {
    const instanceId =
      typeof req.query.instanceId === 'string' ? req.query.instanceId : undefined;
    const bodyId =
      !instanceId && req.body && typeof req.body === 'object'
        ? (req.body as { instanceId?: unknown }).instanceId
        : undefined;
    const id = instanceId ?? (typeof bodyId === 'string' ? bodyId : undefined);
    if (!id) throw new DiscoveryError(ErrorCode.BAD_REQUEST, 'instanceId is required', 400);
    const all = await registry.list();
    const inst = all.find((i) => i.instanceId === id);
    if (!inst) {
      throw new DiscoveryError(ErrorCode.INSTANCE_NOT_FOUND, `instance not found: ${id}`, 404);
    }
    const hooksJsonPath = resolve(codexMirrorDirPath(mirrorBase, inst.cwd), 'hooks.json');
    return { instanceId: id, cwd: inst.cwd, hooksJsonPath };
  }

  router.get('/integrations/codex/trust', authModule.requireAuth, wrap(async (req, res) => {
    const { hooksJsonPath } = await resolveContext(req);
    const st = readCodexTrustStatus(userConfigToml, hooksJsonPath);
    const payload: CodexTrustResponse = {
      ok: true,
      status: st.status,
      matched: st.matched,
      total: st.total,
      mirrorReady: hooksJsonExists(hooksJsonPath),
    };
    res.json(payload);
  }));

  router.post('/integrations/codex/trust', authModule.requireAuth, wrap(async (req, res) => {
    const { instanceId, hooksJsonPath } = await resolveContext(req);
    const count = grantCodexTrust(userConfigToml, hooksJsonPath);
    const st = readCodexTrustStatus(userConfigToml, hooksJsonPath);
    logger.info({ instanceId, count }, 'codex trust: 用户一键授权完成');
    const payload: CodexTrustResponse = {
      ok: true,
      status: st.status,
      matched: st.matched,
      total: st.total,
      mirrorReady: hooksJsonExists(hooksJsonPath),
    };
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
        res.status(err.httpStatus).json({ error: { code: err.code, message: err.message } });
        return;
      }
      logger.error({ err }, '/api/integrations/codex/trust unexpected error');
      res.status(500).json({
        error: { code: ErrorCode.INTERNAL_ERROR, message: 'internal error' },
      });
    }
  };
}
