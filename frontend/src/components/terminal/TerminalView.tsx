/**
 * TerminalView
 *
 * 终端容器，极薄壳。所有逻辑都在 useTerminal 里。
 */

import { forwardRef } from 'react';
import { cn } from '../../utils/cn.js';

export interface TerminalViewProps {
  className?: string;
}

export const TerminalView = forwardRef<HTMLDivElement, TerminalViewProps>(
  function TerminalView({ className }, ref) {
    return <div ref={ref} className={cn('h-full w-full', className)} />;
  },
);
