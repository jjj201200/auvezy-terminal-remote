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

import { type CSSProperties, type JSX, type ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Drawer } from 'vaul';
import { IconX } from '@tabler/icons-react';
import clsx from 'clsx';
import { useModalLayer } from './modal-stack/ModalStack.js';
import { useMediaQuery } from '../../hooks/useMediaQuery.js';
import { useT } from '../../i18n/i18n-context.js';
import { ScrollableTabs } from '../input/ScrollableTabs.js';
import s from './Sheet.module.scss';

/** Sheet header 内嵌 tab 栏的描述（用 ScrollableTabs 渲染，自动处理溢出） */
export interface SheetTab {
  id: string;
  title: string;
}

export interface SheetProps {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  /** Dialog/Drawer 的标题（始终需要——给 sr-only 的 Dialog.Title 用，保 a11y） */
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  /**
   * 当传入 tabs 时，header 同行直接渲染 ScrollableTabs（替代 title 显示），
   * 用与 Toolbar 同款的横向滚动方案处理溢出，不再被挤出 modal 边界。
   * 需要同时受控 activeTab + onTabChange。
   */
  tabs?: ReadonlyArray<SheetTab>;
  activeTab?: string;
  onTabChange?: (id: string) => void;
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
  tabs,
  activeTab,
  onTabChange,
  className,
  id,
}: SheetProps): JSX.Element {
  const isMobile = useMediaQuery('(max-width: 767px)');
  const overlayClass = s.overlay;
  const t = useT();
  // 取本 modal 在栈中的层级。Radix Portal 把 DOM 提到 body 末尾 → CSS var
  // 不能继承，必须 inline-style 写死 z-index + 加深 backdrop。
  const { index: layerZ } = useModalLayer();
  // 嵌套层 backdrop 加深：第 0 层 1×、第 1 层 2×、第 2 层 3× ...
  // 让一层比一层暗，下层不会"看着像没遮罩"
  const overlayStyle: CSSProperties = {
    ['--modal-layer-z' as string]: String(layerZ),
  };

  // header 主区域：tabs 模式 → ScrollableTabs（自动溢出滚动）；否则显示 title 文本
  const headerMain = tabs && tabs.length > 0 ? (
    <ScrollableTabs
      items={tabs as { id: string; title: string }[]}
      activeId={activeTab ?? null}
      onChange={(id) => onTabChange?.(id)}
      direction="ltr"
      className={s.headerTabs}
    />
  ) : (
    <span className={s.title}>{title}</span>
  );

  if (isMobile) {
    return (
      <Drawer.Root
        open={open}
        onOpenChange={onOpenChange}
        // 仅顶部 grip 才能拖动关闭，避免列表 / 输入框纵向滚动被识别为拖拽
        handleOnly={true}
        // vaul 的 reposition 会用 transform 上推 drawer，与我们的 CSS（--vv-bottom 接管 padding）
        // 叠加会双重偏移。由 CSS 单独接管
        repositionInputs={false}
      >
        <Drawer.Portal>
          {/* 点遮罩 = 关闭。手动绑 onClick 显式接管，不靠 Radix outside 自动检测——
              键盘弹起期 visualViewport 与 layout viewport 不一致，Radix 把 drawer
              内点击误判为外部 → 触发关闭，是之前的关弹层 bug 根因 */}
          <Drawer.Overlay
            className={overlayClass}
            style={overlayStyle}
            onClick={() => onOpenChange(false)}
          />
          <Drawer.Content
            id={id}
            className={clsx(s.drawerContent, className)}
            style={overlayStyle}
            // 屏蔽 Radix 默认 outside / focus 自动关闭，由 Overlay onClick 显式接管
            onPointerDownOutside={(e) => e.preventDefault()}
            onInteractOutside={(e) => e.preventDefault()}
            onFocusOutside={(e) => e.preventDefault()}
          >
            {/* a11y 必填：Drawer.Title 始终存在但 sr-only，避免 vaul/Radix 警告 */}
            <Drawer.Title className={s.srOnly}>{title}</Drawer.Title>
            <Drawer.Handle className={s.drawerGrip} />
            <header className={clsx(s.header, s.headerMobile, tabs && s.headerWithTabs)}>
              {headerMain}
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                aria-label={t('common.close')}
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
        <Dialog.Overlay
          className={overlayClass}
          style={overlayStyle}
          onClick={() => onOpenChange(false)}
        />
        <Dialog.Content
          id={id}
          className={clsx(s.dialogContent, className)}
          style={overlayStyle}
          // 屏蔽 Radix 默认 outside 检测（键盘弹起时坐标算不准），
          // 由 Overlay onClick 显式接管"点外部关闭"
          onPointerDownOutside={(e) => e.preventDefault()}
          onInteractOutside={(e) => e.preventDefault()}
          onFocusOutside={(e) => e.preventDefault()}
        >
          {/* tabs 模式下 Dialog.Title 隐藏到 sr-only（Radix 仍要求一个 Title 节点） */}
          {tabs && tabs.length > 0 && (
            <Dialog.Title className={s.srOnly}>{title}</Dialog.Title>
          )}
          <header className={clsx(s.header, tabs && s.headerWithTabs)}>
            {tabs && tabs.length > 0 ? headerMain : (
              <Dialog.Title className={s.title}>{title}</Dialog.Title>
            )}
            <Dialog.Close asChild>
              <button type="button" aria-label={t('common.close')} className={s.close}>
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
