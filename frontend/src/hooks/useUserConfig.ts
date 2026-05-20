/**
 * useUserConfig
 *
 * 管理前端的用户偏好(shortcuts/commands/fontScale 等):
 *  - 首次挂载:从 /api/config 拉
 *  - 拉到之前先用 localStorage 缓存兜底(避免 InputBar 闪烁)
 *  - save(value) → PUT 后用返回值刷新内存 + 缓存
 *  - 失败时不破坏已有值,只 setError
 *
 * 不做的事:
 *  - 字段级 patch(PUT 整体替换,避免并发冲突)
 *  - 多设备实时同步:LAN 自用场景下用户基本一次只在一台设备改;有需要时
 *    sheet 关闭再开会重新 fetch 拿到最新值。真要做实时 sync 需要 broker
 *    SSE/WS broadcast `config:updated` + 各客户端 reconcile,目前不必要。
 */

import { useEffect, useState, useCallback } from 'react';
import {
  ensureDefaultUserConfig,
  type UserConfig,
} from 'auvezy-terminal-remote-shared';
import { fetchUserConfig, saveUserConfigRemote } from '../services/config-api.js';

const LS_KEY = 'atr.userConfig.v1';

function readCache(): UserConfig | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? (JSON.parse(raw) as UserConfig) : null;
  } catch {
    return null;
  }
}

function writeCache(v: UserConfig): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(v));
  } catch {
    /* 配额满或隐私模式：忽略 */
  }
}

export interface UseUserConfigResult {
  /** 当前已合并默认值的配置 */
  config: UserConfig;
  /** 是否还在首次拉取 */
  loading: boolean;
  /** 最近一次错误（保存或加载失败） */
  error: string | null;
  /** 保存（整体替换）；返回是否成功 */
  save: (value: UserConfig) => Promise<boolean>;
  /** 重新拉取 */
  reload: () => Promise<void>;
}

export function useUserConfig(): UseUserConfigResult {
  const [config, setConfig] = useState<UserConfig>(() =>
    ensureDefaultUserConfig(readCache()),
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async (): Promise<void> => {
    setLoading(true);
    const r = await fetchUserConfig();
    if (r.ok && r.data) {
      const merged = ensureDefaultUserConfig(r.data.config);
      setConfig(merged);
      writeCache(merged);
      setError(null);
    } else {
      setError(r.error?.message ?? '配置加载失败');
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const save = useCallback(async (value: UserConfig): Promise<boolean> => {
    const r = await saveUserConfigRemote(value);
    if (r.ok && r.data) {
      const merged = ensureDefaultUserConfig(r.data.config);
      setConfig(merged);
      writeCache(merged);
      setError(null);
      return true;
    }
    setError(r.error?.message ?? '保存失败');
    return false;
  }, []);

  return { config, loading, error, save, reload };
}
