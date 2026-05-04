/**
 * TerminalView
 *
 * 终端容器组件，极薄壳：仅提供一个 div 让 useTerminal 把 xterm 挂上去。
 * 所有逻辑（写入、滚动、resize 上报）都在 hook 里。
 */

import { forwardRef } from 'react';

export interface TerminalViewProps {
  className?: string;
}

/**
 * 用 forwardRef 让父组件能拿到容器 ref 传给 useTerminal
 */
export const TerminalView = forwardRef<HTMLDivElement, TerminalViewProps>(
  function TerminalView({ className }, ref) {
    return <div ref={ref} className={className ?? 'terminal-view'} />;
  },
);
