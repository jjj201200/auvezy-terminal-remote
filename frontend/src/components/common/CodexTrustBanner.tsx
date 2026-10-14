/**
 * CodexTrustBanner
 *
 * codex 实例上"hooks 未授权"的提示横幅:codex 对非托管 hooks 默认不信任、
 * 静默跳过,atr 注入的事件回调因此不生效(状态栏无审批/工具进度)。横幅
 * 提供一键授权(写 ~/.codex/config.toml 的 trusted_hash),授权后转为
 * "已授权,重启 codex 生效"提示(trust 记录是 codex 启动时加载的),数秒
 * 后自动隐藏。
 *
 * 显隐由父级(InstanceView)控制:integrationId === 'codex' 时挂载本组件,
 * 已授权(trusted)时组件自渲染 null。
 */

import { useEffect, useRef, useState, type JSX } from 'react';
import { useT } from '../../i18n/i18n-context.js';
import { fetchCodexTrustStatus, grantCodexTrustRemote } from '../../services/integrations-api.js';
import s from './CodexTrustBanner.module.scss';

export interface CodexTrustBannerProps {
  /** 实例 id(backend 按 cwd 派生镜像 hooks.json 路径) */
  instanceId: string;
}

type Phase = 'checking' | 'untrusted' | 'justGranted' | 'error';

export function CodexTrustBanner({ instanceId }: CodexTrustBannerProps): JSX.Element | null {
  const t = useT();
  const [phase, setPhase] = useState<Phase>('checking');
  const [busy, setBusy] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    setPhase('checking');
    fetchCodexTrustStatus(instanceId).then((res) => {
      if (cancelled) return;
      // 已授权(trusted)保持 checking 态渲染 null;未授权/失败进入对应相
      if (res.ok && res.data?.status === 'trusted') return;
      setPhase(res.ok ? 'untrusted' : 'error');
    }).catch(() => {
      if (!cancelled) setPhase('error');
    });
    return () => {
      cancelled = true;
    };
  }, [instanceId]);

  // justGranted 提示条 6s 后自动隐藏
  useEffect(() => {
    if (phase !== 'justGranted') return;
    hideTimer.current = setTimeout(() => setPhase('checking'), 6000);
    return () => {
      if (hideTimer.current !== null) clearTimeout(hideTimer.current);
    };
  }, [phase]);

  if (phase === 'checking') return null;

  if (phase === 'error') {
    return (
      <div className={s.root} data-tone="error" role="status">
        <span className={s.text}>{t('codexTrust.queryError')}</span>
      </div>
    );
  }

  if (phase === 'justGranted') {
    return (
      <div className={s.root} data-tone="ok" role="status">
        <span className={s.text}>{t('codexTrust.grantedHint')}</span>
      </div>
    );
  }

  const grant = async (): Promise<void> => {
    setBusy(true);
    const res = await grantCodexTrustRemote(instanceId);
    setBusy(false);
    if (res.ok && res.data?.status === 'trusted') setPhase('justGranted');
    // 失败停在 untrusted(可重点);异常细节在 console,横幅文案保持通用
  };

  return (
    <div className={s.root} role="status">
      <span className={s.text}>{t('codexTrust.bannerText')}</span>
      <button type="button" className={s.action} disabled={busy} onClick={() => void grant()}>
        {busy ? t('codexTrust.granting') : t('codexTrust.grantButton')}
      </button>
    </div>
  );
}
