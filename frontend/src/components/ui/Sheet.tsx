/**
 * Sheet
 *
 * 双形态弹层:
 *  - 桌面(≥768px):Radix Dialog 居中卡片
 *  - 移动(<768px):vaul Drawer 底部滑入
 *
 * ## 架构:Radix/vaul 降级为"纯渲染 / 动画 / a11y"工具
 *
 * 历史上 Sheet 直接用 Radix Dialog 的"modal 模式",它内置:
 *   1. focus trap        2. body scroll lock(react-remove-scroll)
 *   3. outside-click 关  4. DismissableLayer 的 inline pointer-events 锁
 *
 * 但本项目有自己的 [[ModalStack]] 系统(支持栈、bringToTop、inert 隔离),它
 * 已经接管:
 *   1. focus 隔离(layer `inert={!isTop}`)
 *   2. outside 屏蔽(layer `pointer-events:none` 非顶 + auto 顶)
 *   3. esc 关栈顶 / 点 backdrop 关栈顶
 *
 * Radix 的 modal 模式与 ModalStack 抢同一份职责,且 react-remove-scroll 的
 * 全局 lockStack 与 bringToTop 不兼容 — 视觉顶 layer 不在 lockStack 顶 → wheel
 * 事件被错误 preventDefault → 鼠标滚轮失效。
 *
 * **结论**:Sheet 永久走 `Dialog.Root modal={false}` / `Drawer.Root modal={false}`,
 * Radix/vaul 只做:
 *   - Portal 到 ModalLayer 的 container
 *   - 入退场动画(pop-in/pop-out / drawer slide)
 *   - a11y(Title / aria-labelledby)
 *   - vaul 的 drag-to-dismiss 手势(移动端)
 *
 * Backdrop 由 Sheet **自己**画(一个简单 div,fixed inset:0,onClick=close)—
 * 不用 `Dialog.Overlay`,因为它在 modal=false 时**整体不渲染**。
 */

import { useId, type JSX, type ReactNode } from 'react';
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
  /**
   * 语义标记(用于 e2e / 调试选择)。**不**会直接写到 DOM 的 `id` 属性上 —
   * 因为同一 sheet 组件可能在 modal-stack 里出现多个实例(如多个
   * FilePreviewSheet 叠加),DOM id 必须唯一。
   *
   * 实际 DOM 上:`data-sheet-id="<这个 id>"`(可重复,用 querySelectorAll);
   * `id="<useId 生成的唯一 id>"`(浏览器/aria-labelledby 用)。
   */
  id?: string;
  /**
   * 标题栏右侧附加控件(在 X 关闭按钮之前)。常见用例:文件预览的"自动换行"
   * toggle、列表的"显示隐藏文件"开关 — 把这些和 modal 绑定的辅助控件直接
   * 嵌在 header,避免 body 内自己再画一条 header bar。
   */
  headerExtra?: ReactNode;
  /**
   * 隐藏 vaul Drawer 顶部的拖拽手柄(grip)。全屏 sheet(文件预览 / 栈视图)
   * 不需要"下拉关闭"语义,手柄只占空间,显式隐藏后释放出顶部 ~12px。
   * 桌面 Dialog 没有手柄,该 prop 仅影响移动端 Drawer。
   * 默认 false(保持原行为)。
   */
  hideDragHandle?: boolean;
  /**
   * 不渲染 backdrop。全屏 sheet(Content 已铺满视口,backdrop 永远被遮)
   * 显式声明 — 既省一个 DOM 节点,也避免它的 fade-in 动画在视觉上造成"先
   * 出现 backdrop 后出现 content"的两段感。
   * 默认 false(显示 backdrop)。
   */
  hideBackdrop?: boolean;
  /**
   * body 去掉默认 padding。给全屏沉浸 sheet(文件预览)用:默认 padding 是为
   * 键盘弹起 / input scrollIntoView 的输入场景设计的,预览内容没有输入,边距
   * 由各 preview 组件自管(MarkdownPreview / TextPreview 自带 padding)。
   * 默认 false(保持原 padding)。
   */
  bodyFlush?: boolean;
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
  headerExtra,
  hideDragHandle = false,
  hideBackdrop = false,
  bodyFlush = false,
}: SheetProps): JSX.Element {
  const isMobile = useMediaQuery('(max-width: 767px)');
  // DOM id 必须唯一 — multiple FilePreviewSheet 叠加时,props.id 会重复;
  // 用 useId() 生成,props.id 降为 data-sheet-id(e2e 选择器仍可用)
  const uniqueId = useId();
  const domId = `${id ?? 'sheet'}-${uniqueId.replace(/:/g, '_')}`;
  // 移动端 vaul Drawer 拖动时会通过 inline opacity 动态控制 backdrop 跟手 fade。
  // 不能用 fade-in/fade-out keyframe(会覆盖 vaul 的 inline opacity)— 给 mobile
  // 单独的 overlay class,只设静态背景 + backdrop-filter,不带 animation
  const backdropClass = isMobile ? s.overlayMobile : s.overlay;
  const t = useT();
  // ModalStack 给本层 modal 提供独立 portal container:Radix Portal 指向它
  // 后,layer N 的 DOM 自然在 layer N-1 之后渲染。container 为 null 时回退
  // 到 body(首次 mount 前 / 无 stack 场景)。
  const { container } = useModalLayer();

  // header 主区域:tabs 模式 → ScrollableTabs(自动溢出滚动);否则显示 title 文本
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

  // 自画 backdrop — 替代 Radix Dialog.Overlay(modal=false 时不渲染)。
  // 桌面端走 Radix Dialog 渲染,backdrop 与 Content 都在同一 Portal container
  // (layer div)内,DOM 顺序 backdrop 在前 → Content 自然盖在上面。
  // 移动端 vaul 同理。
  const backdrop = hideBackdrop ? null : (
    <div
      className={backdropClass}
      data-state={open ? 'open' : 'closed'}
      onClick={() => onOpenChange(false)}
      // a11y:backdrop 是装饰,不需要 role
      aria-hidden
    />
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
        // 永久 nonModal:见文件顶部"架构"注释。vaul 也用 react-remove-scroll
        // 类机制锁 scroll,modal=false 完全绕开
        modal={false}
      >
        <Drawer.Portal container={container ?? undefined}>
          {backdrop}
          <Drawer.Content
            id={domId}
            data-sheet-id={id}
            className={clsx(s.drawerContent, className)}
            // 屏蔽 vaul 默认 outside / focus 自动关闭,由 backdrop onClick 显式接管
            onPointerDownOutside={(e) => e.preventDefault()}
            onInteractOutside={(e) => e.preventDefault()}
            onFocusOutside={(e) => e.preventDefault()}
          >
            {/* a11y 必填:Drawer.Title 始终存在但 sr-only,避免 vaul/Radix 警告 */}
            <Drawer.Title className={s.srOnly}>{title}</Drawer.Title>
            {!hideDragHandle && <Drawer.Handle className={s.drawerGrip} />}
            <header className={clsx(s.header, s.headerMobile, tabs && s.headerWithTabs)}>
              {headerMain}
              {headerExtra && <div className={s.headerExtra}>{headerExtra}</div>}
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                aria-label={t('common.close')}
                className={s.close}
              >
                <IconX size={16} stroke={1.5} />
              </button>
            </header>
            <div className={clsx(s.body, bodyFlush && s.bodyFlush)}>{children}</div>
            {footer && (
              <footer className={clsx(s.footer, s.footerMobile)}>{footer}</footer>
            )}
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>
    );
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange} modal={false}>
      <Dialog.Portal container={container ?? undefined}>
        {backdrop}
        <Dialog.Content
          id={domId}
          data-sheet-id={id}
          className={clsx(s.dialogContent, className)}
          // 屏蔽 Radix 默认 outside 检测(键盘弹起时坐标算不准),
          // 由 backdrop onClick 显式接管"点外部关闭"
          onPointerDownOutside={(e) => e.preventDefault()}
          onInteractOutside={(e) => e.preventDefault()}
          onFocusOutside={(e) => e.preventDefault()}
          // a11y:Radix 在缺 description 时会 console.warn 建议加 aria-describedby。
          // 我们的 Sheet 是通用容器,内容由调用方决定,统一显式声明「无描述」
          // 来消警告(不影响截屏阅读器 — Title 已足够标识 modal)
          aria-describedby={undefined}
        >
          {/* tabs 模式下 Dialog.Title 隐藏到 sr-only（Radix 仍要求一个 Title 节点） */}
          {tabs && tabs.length > 0 && (
            <Dialog.Title className={s.srOnly}>{title}</Dialog.Title>
          )}
          <header className={clsx(s.header, tabs && s.headerWithTabs)}>
            {tabs && tabs.length > 0 ? headerMain : (
              <Dialog.Title className={s.title}>{title}</Dialog.Title>
            )}
            {headerExtra && <div className={s.headerExtra}>{headerExtra}</div>}
            <Dialog.Close asChild>
              <button type="button" aria-label={t('common.close')} className={s.close}>
                <IconX size={16} stroke={1.5} />
              </button>
            </Dialog.Close>
          </header>
          <div className={clsx(s.body, bodyFlush && s.bodyFlush)}>{children}</div>
          {footer && <footer className={s.footer}>{footer}</footer>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
