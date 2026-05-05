/**
 * InstanceTabs（桌面）
 *
 * 顶部横向标签条；每个实例一个 tab；点击非当前实例 → location.assign。
 * 「+」按钮触发 onCreateClick。移动端不渲染（用 MobileInstanceSwitcher）。
 */

import { type JSX } from 'react';
import { Plus } from 'lucide-react';
import type { InstanceListItem } from '@ocr/shared';
import { cn } from '../../utils/cn.js';

export interface InstanceTabsProps {
  instances: InstanceListItem[];
  /** 点 + 时调用 */
  onCreateClick: () => void;
}

export function InstanceTabs({ instances, onCreateClick }: InstanceTabsProps): JSX.Element {
  const handleSwitch = (i: InstanceListItem): void => {
    if (i.isCurrent) return;
    // 跨端口跳转；同 host
    window.location.assign(`http://${i.host}:${i.port}/`);
  };

  return (
    <nav className="flex items-center gap-1 overflow-x-auto scrollbar-hide" aria-label="实例切换">
      {instances.map((i) => (
        <button
          key={i.instanceId}
          type="button"
          onClick={() => handleSwitch(i)}
          title={`${i.cwd} · pid=${i.pid}`}
          disabled={i.isCurrent}
          className={cn(
            'inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-2 py-1 text-xs',
            i.isCurrent
              ? 'border-[var(--color-accent)] bg-[var(--color-bg)] text-[var(--color-fg)] cursor-default'
              : 'border-[var(--color-border)] text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] hover:border-[var(--color-fg-muted)]',
          )}
        >
          <span>{i.name}</span>
          <span className="font-mono text-2xs opacity-70">:{i.port}</span>
        </button>
      ))}
      <button
        type="button"
        onClick={onCreateClick}
        title="创建新实例"
        aria-label="创建新实例"
        className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-[var(--color-border)] text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] hover:border-[var(--color-fg-muted)]"
      >
        <Plus size={14} strokeWidth={1.5} />
      </button>
    </nav>
  );
}
