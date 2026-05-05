/**
 * Sheet
 *
 * 双形态弹层：
 *  - 桌面（≥768px）：Radix Dialog 居中卡片 + 背景高斯模糊
 *  - 移动（<768px）：vaul Drawer 底部滑入
 *
 * 共享 API：受控 open；title 显示在头部；children 内容由调用者负责。
 * footer 可选（按钮区，桌面 / 移动一致）。
 */

import { type JSX, type ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Drawer } from 'vaul';
import { IconX } from '@tabler/icons-react';
import clsx from 'clsx';
import { useMediaQuery } from '../../hooks/useMediaQuery.js';
import s from './Sheet.module.scss';

export interface SheetProps {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  /**
   * 渲染在 header 标题与关闭按钮之间的额外内容。
   * 适合放 Tabs.List 这类「不应跟随内容滚动」的导航元素。
   */
  headerExtra?: ReactNode;
  className?: string;
  /** 可选 DOM id（用于唯一容器，如 settings-modal / create-instance-modal） */
  id?: string;
}

export function Sheet({
  open,
  onOpenChange,
  title,
  children,
  footer,
  headerExtra,
  className,
  id,
}: SheetProps): JSX.Element {
  const isMobile = useMediaQuery('(max-width: 767px)');

  if (isMobile) {
    return (
      <Drawer.Root
        open={open}
        onOpenChange={onOpenChange}
        // 仅顶部 grip 才能拖动关闭，避免列表 / 输入框纵向滚动被识别为拖拽
        handleOnly={true}
        // 输入框聚焦时由 vaul 把内容上推让 input 可见，而不是被键盘盖
        repositionInputs={true}
      >
        <Drawer.Portal>
          <Drawer.Overlay className={s.overlay} />
          <Drawer.Content id={id} className={clsx(s.drawerContent, className)}>
            <Drawer.Title className={s.srOnly}>{title}</Drawer.Title>
            <Drawer.Handle className={s.drawerGrip} />
            <header className={clsx(s.header, s.headerMobile)}>
              <span className={s.title}>{title}</span>
              {headerExtra && <div className={s.headerExtra}>{headerExtra}</div>}
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                aria-label="关闭"
                className={s.close}
              >
                <IconX size={16} stroke={1.5} />
              </button>
            </header>
            <div className={s.body}>{children}</div>
            {footer && (
              <footer className={clsx(s.footer, s.footerMobile)}>{footer}</footer>
            )}
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>
    );
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={s.overlay} />
        <Dialog.Content id={id} className={clsx(s.dialogContent, className)}>
          <header className={s.header}>
            <Dialog.Title className={s.title}>{title}</Dialog.Title>
            {headerExtra && <div className={s.headerExtra}>{headerExtra}</div>}
            <Dialog.Close asChild>
              <button type="button" aria-label="关闭" className={s.close}>
                <IconX size={16} stroke={1.5} />
              </button>
            </Dialog.Close>
          </header>
          <div className={s.body}>{children}</div>
          {footer && <footer className={s.footer}>{footer}</footer>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
