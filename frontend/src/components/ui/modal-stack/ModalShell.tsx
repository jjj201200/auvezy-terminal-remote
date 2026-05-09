/**
 * ModalShell —— modal 内容外壳（标题 / body / footer 三段式）
 *
 * 嵌套 modal 时下层不再需要 overlayTone='strong' 来加深背景：ModalLayerRoot 已经
 * 把上层 z-index 抬高 + inert 阻止下层交互。下层 modal 自身的 backdrop 仍正常显示，
 * 但最上层的 backdrop 自带充足模糊（统一 css 处理），不会让下层内容透出来。
 *
 * Shell 包了 Sheet primitive，给所有 modal 提供：
 *  - 标题 / body / footer 三段固定布局
 *  - onClose 直接调 stack.pop
 *  - 桌面 Dialog / 移动 Drawer 的双形态切换（沿用 Sheet 的策略）
 */

import { type JSX, type ReactNode } from 'react';
import { Sheet, type SheetTab } from '../Sheet.js';

export interface ModalShellProps {
  /** 标题（也用作 a11y aria-label） */
  title: string;
  /** 关闭：调用方传 ctx.close 即可 */
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  /** Tab 模式：传了 tabs 时 header 改渲染 ScrollableTabs */
  tabs?: ReadonlyArray<SheetTab>;
  activeTab?: string;
  onTabChange?: (id: string) => void;
  /** DOM id（调试 + e2e 选择器） */
  id?: string;
  className?: string;
}

export function ModalShell(props: ModalShellProps): JSX.Element {
  const { title, onClose, children, footer, tabs, activeTab, onTabChange, id, className } = props;
  return (
    <Sheet
      id={id}
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={title}
      footer={footer}
      tabs={tabs}
      activeTab={activeTab}
      onTabChange={onTabChange}
      className={className}
    >
      {children}
    </Sheet>
  );
}
