/**
 * IpChangeToast
 *
 * 屏幕底部黄色横条，提示 LAN IP 已变化、显示新 URL，让用户更新书签 / 重新扫码。
 *
 * 设计：
 *  - 不自动消失：IP 漂移是真要响应的事件，让用户主动 dismiss
 *  - 「复制链接」按钮把 newUrl 复制到剪贴板
 *  - 一行不够时换行；按钮始终在右
 */

import { type JSX, useState } from 'react';

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
      // 拒绝权限或非 https 上下文：fallback 选中
      setCopied(false);
    }
  };

  return (
    <div className="ip-change-toast" role="alert" aria-live="polite">
      <div className="ip-change-toast__content">
        <span className="ip-change-toast__title">⚠ 服务端 IP 已变化</span>
        <span className="ip-change-toast__detail">
          {info.oldIp} → <strong>{info.newIp}</strong>
        </span>
        <span className="ip-change-toast__url">{target}</span>
      </div>
      <div className="ip-change-toast__actions">
        <button type="button" className="ip-change-toast__btn" onClick={() => void copy()}>
          {copied ? '已复制' : '复制链接'}
        </button>
        <button type="button" className="ip-change-toast__btn" onClick={onDismiss}>
          关闭
        </button>
      </div>
    </div>
  );
}
