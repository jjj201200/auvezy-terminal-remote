/**
 * IpChangeToast
 *
 * 屏幕底部黄色横条，IP 漂移时提示用户。
 * 不自动消失；手动 dismiss 或点"复制链接"。
 *
 * 位置上移到 InputBar 之上（避免压输入栏）：bottom = 输入栏高度（约 52） + safe-bottom + 8。
 */

import { useState, type JSX } from 'react';
import { cn } from '../../utils/cn.js';

export interface IpChangeInfo {
  oldIp: string;
  newIp: string;
  /** 服务端可选地附带新 URL；前端没有 token 用这个 */
  newUrl?: string;
}

export interface IpChangeToastProps {
  info: IpChangeInfo | null;
  onDismiss: () => void;
}

export function IpChangeToast({ info, onDismiss }: IpChangeToastProps): JSX.Element | null {
  const [copied, setCopied] = useState(false);
  if (!info) return null;

  const target = info.newUrl ?? `http://${info.newIp}/`;

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(target);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // 拒绝权限或非 https 上下文：不做 fallback，保持 false
      setCopied(false);
    }
  };

  return (
    <div
      role="alert"
      aria-live="polite"
      className={cn(
        'fixed left-2 right-2 z-30 flex flex-wrap items-center gap-2 rounded-lg bg-[var(--color-warning)] px-3 py-2.5 text-sm text-[#0d1117] shadow-xl',
        'bottom-[calc(52px+env(safe-area-inset-bottom)+8px)]',
      )}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="font-medium">服务端 IP 已变化</span>
        <span className="font-mono text-xs">
          {info.oldIp} → <strong>{info.newIp}</strong>
        </span>
        <span className="break-all font-mono text-2xs opacity-80">{target}</span>
      </div>
      <div className="flex gap-1">
        <button
          type="button"
          onClick={() => void copy()}
          className="rounded border border-black/30 bg-black/15 px-2.5 py-1 text-xs text-[#0d1117] hover:bg-black/25"
        >
          {copied ? '已复制' : '复制链接'}
        </button>
        <button
          type="button"
          onClick={onDismiss}
          className="rounded border border-black/30 bg-black/15 px-2.5 py-1 text-xs text-[#0d1117] hover:bg-black/25"
        >
          关闭
        </button>
      </div>
    </div>
  );
}
