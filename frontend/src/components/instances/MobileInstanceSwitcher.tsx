/**
 * MobileInstanceSwitcher
 *
 * 移动端：右上角按钮 = 当前实例名 + 切换图标。
 * 点击打开底部 sheet 列出全部实例 + 创建按钮。
 */

import { useState, type JSX } from 'react';
import { LayoutGrid, Plus } from 'lucide-react';
import type { InstanceListItem } from '@ocr/shared';
import { Sheet } from '../ui/Sheet.js';
import { cn } from '../../utils/cn.js';

export interface MobileInstanceSwitcherProps {
  instances: InstanceListItem[];
  onCreateClick: () => void;
}

export function MobileInstanceSwitcher({
  instances,
  onCreateClick,
}: MobileInstanceSwitcherProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const current = instances.find((i) => i.isCurrent);

  const handleSwitch = (i: InstanceListItem): void => {
    if (i.isCurrent) {
      setOpen(false);
      return;
    }
    window.location.assign(`http://${i.host}:${i.port}/`);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-md border border-[var(--color-border)] px-2 py-1 text-xs text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]"
        aria-label="切换实例"
      >
        <LayoutGrid size={12} strokeWidth={1.5} />
        <span className="max-w-[100px] truncate">{current?.name ?? '未命名'}</span>
        <span className="font-mono text-2xs opacity-70">:{current?.port ?? '-'}</span>
      </button>

      <Sheet open={open} onOpenChange={setOpen} title="实例">
        <div className="flex flex-col gap-1.5">
          {instances.map((i) => (
            <button
              key={i.instanceId}
              type="button"
              onClick={() => handleSwitch(i)}
              className={cn(
                'flex items-center justify-between rounded-md border px-3 py-2 text-left text-sm',
                i.isCurrent
                  ? 'border-[var(--color-accent)] bg-[var(--color-bg)] text-[var(--color-fg)]'
                  : 'border-[var(--color-border)] text-[var(--color-fg-muted)] hover:bg-[var(--color-bg)]',
              )}
            >
              <div className="flex flex-col gap-0.5 min-w-0">
                <span className="truncate text-[var(--color-fg)]">{i.name}</span>
                <span className="truncate font-mono text-xs">{i.cwd}</span>
              </div>
              <span className="ml-2 font-mono text-xs opacity-70">:{i.port}</span>
            </button>
          ))}
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onCreateClick();
            }}
            className="inline-flex items-center justify-center gap-1.5 rounded-md border border-dashed border-[var(--color-border)] px-3 py-2 text-sm text-[var(--color-accent)] hover:border-[var(--color-accent)]"
          >
            <Plus size={14} strokeWidth={1.5} />
            创建新实例
          </button>
        </div>
      </Sheet>
    </>
  );
}
