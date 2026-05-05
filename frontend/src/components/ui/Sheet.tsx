/**
 * Sheet
 *
 * 双形态弹层：
 *  - 桌面（≥768px）：Radix Dialog 居中卡片
 *  - 移动（<768px）：vaul Drawer 底部滑入
 *
 * 共享 API：受控 open；title 显示在头部；children 内容由调用者负责。
 * footer 可选（按钮区，桌面 / 移动一致）。
 */

import { type JSX, type ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Drawer } from 'vaul';
import { X } from 'lucide-react';
import { useMediaQuery } from '../../hooks/useMediaQuery.js';
import { cn } from '../../utils/cn.js';

export interface SheetProps {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  /** 内容区附加 className（覆盖默认 max-h 等） */
  className?: string;
}

export function Sheet({
  open,
  onOpenChange,
  title,
  children,
  footer,
  className,
}: SheetProps): JSX.Element {
  const isMobile = useMediaQuery('(max-width: 767px)');

  if (isMobile) {
    return (
      <Drawer.Root open={open} onOpenChange={onOpenChange}>
        <Drawer.Portal>
          <Drawer.Overlay className="fixed inset-0 z-40 bg-black/60" />
          <Drawer.Content
            className={cn(
              'fixed inset-x-0 bottom-0 z-50 flex max-h-[90dvh] flex-col rounded-t-xl border-t border-[var(--color-border)] bg-[var(--color-bg-elevated)] outline-none',
              className,
            )}
          >
            <Drawer.Title className="sr-only">{title}</Drawer.Title>
            <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-[var(--color-border)]" />
            <header className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)]">
              <span className="text-md text-[var(--color-fg)]">{title}</span>
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                aria-label="关闭"
                className="text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] p-1"
              >
                <X size={16} strokeWidth={1.5} />
              </button>
            </header>
            <div className="flex-1 overflow-y-auto scrollbar-hide px-4 py-3">{children}</div>
            {footer && (
              <footer className="flex justify-end gap-2 border-t border-[var(--color-border)] px-4 py-3 pb-[calc(env(safe-area-inset-bottom)+12px)]">
                {footer}
              </footer>
            )}
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>
    );
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60" />
        <Dialog.Content
          className={cn(
            'fixed left-1/2 top-1/2 z-50 flex w-full max-w-[640px] max-h-[90dvh] -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-elevated)] outline-none',
            className,
          )}
        >
          <header className="flex items-center justify-between px-5 py-3 border-b border-[var(--color-border)]">
            <Dialog.Title className="text-md text-[var(--color-fg)] font-medium">
              {title}
            </Dialog.Title>
            <Dialog.Close asChild>
              <button
                type="button"
                aria-label="关闭"
                className="text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] p-1"
              >
                <X size={16} strokeWidth={1.5} />
              </button>
            </Dialog.Close>
          </header>
          <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
          {footer && (
            <footer className="flex justify-end gap-2 border-t border-[var(--color-border)] px-5 py-3">
              {footer}
            </footer>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
