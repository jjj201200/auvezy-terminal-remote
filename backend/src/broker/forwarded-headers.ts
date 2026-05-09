/**
 * X-ATR-Forwarded-* 协议（0.7.0 broker → worker）
 *
 * 详见 ADR-008。本文件提供：
 *  - 头名常量（broker 注入端 + worker 解析端共用，避免拼写漂移）
 *  - `getPublicUrl(req, subPath)`：worker 端从头反推用户外部访问 URL，
 *    用于 push subscription endpoint / share URL / 扫码 URL
 *  - `getInstanceFromHeaders`：从可信头取 instanceId（broker 注入，worker 信任）
 *
 * 设计要点：
 *  - 头大小写无关（http 标准）；Express `req.headers` 已小写化
 *  - `X-ATR-` 前缀的头一律视作 broker 注入的可信内容（worker 只听 127.0.0.1，
 *    外部 client 包到不了 worker，详见 ADR-008 安全考虑）
 *  - 直连 worker（无 broker，仅调试场景）时头缺失，回退用 `req.host`，并加
 *    一行 debug 日志
 */

import type { Request } from 'express';

/** broker 注入实例 id */
export const HEADER_FORWARDED_INSTANCE = 'x-atr-forwarded-instance';
/** broker 注入用户访问的完整路径（含 /i/<id>/） */
export const HEADER_FORWARDED_PATH = 'x-atr-forwarded-path';
/** 标准 `X-Forwarded-Host`，含 port */
export const HEADER_FORWARDED_HOST = 'x-forwarded-host';
/** 标准 `X-Forwarded-Proto`：http / https */
export const HEADER_FORWARDED_PROTO = 'x-forwarded-proto';
/** 标准 `X-Forwarded-For`：真实 client IP */
export const HEADER_FORWARDED_FOR = 'x-forwarded-for';

/**
 * 从一组小写化的 header map 取单值
 *
 * Node 的 `req.headers` 多值头会变 string[]，单值就是 string。
 * push helper 不接受 array，统一取首项。
 */
function pickHeader(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  const v = headers[name];
  if (Array.isArray(v)) return v[0];
  return v;
}

/** 从可信头取 instance id；无则 null */
export function getInstanceFromHeaders(
  headers: Record<string, string | string[] | undefined>,
): string | null {
  const v = pickHeader(headers, HEADER_FORWARDED_INSTANCE);
  return v && v.length > 0 ? v : null;
}

/**
 * 反推用户外部访问 URL
 *
 * @param req     Express Request（worker 端）
 * @param subPath 拼接到 base 后的路径，**不要带前导斜杠**（base 已带 `/`）
 * @returns       完整 URL，如 `https://wsl.tail3e456b.ts.net/i/<id>/api/push/foo`
 *
 * 头都齐全时返回 `${proto}://${host}/i/${instance}${subPath}`。
 * 直连兜底（无 broker，调试场景）：用 `req.protocol` + `req.get('host')`，
 * 不带 `/i/<id>/` 前缀（直连 worker 没有 instance 概念）。
 *
 * @example
 * // broker 反代过来：getPublicUrl(req, '/api/push/sub') →
 * //   "https://atr.example.com/i/abc-123/api/push/sub"
 * // 直连 worker：→ "http://127.0.0.1:43210/api/push/sub"
 */
export function getPublicUrl(req: Request, subPath = ''): string {
  const headers = req.headers;
  const instance = getInstanceFromHeaders(headers);
  const fwdHost = pickHeader(headers, HEADER_FORWARDED_HOST);
  const fwdProto = pickHeader(headers, HEADER_FORWARDED_PROTO);

  // 规范 subPath：保证以 '/' 起头（调用方写 '/api/foo' 或 'api/foo' 都接受）
  const normalizedSub = subPath.length > 0 && !subPath.startsWith('/') ? `/${subPath}` : subPath;

  if (instance && fwdHost) {
    const proto = fwdProto ?? 'http';
    return `${proto}://${fwdHost}/i/${instance}${normalizedSub}`;
  }

  // 直连兜底：req.protocol 来自 Express（信任 trust proxy 设置）；req.get('host') 带 port
  const proto = req.protocol || 'http';
  const host = req.get('host') ?? '127.0.0.1';
  return `${proto}://${host}${normalizedSub}`;
}

/**
 * 是否经由 broker 反代而来
 *
 * 判定标准：HEADER_FORWARDED_INSTANCE 存在。
 * 用于：直连兜底分支的 debug 日志开关、安全断言（worker 应只接受反代来源）。
 */
export function isFromBroker(req: Request): boolean {
  return getInstanceFromHeaders(req.headers) !== null;
}
