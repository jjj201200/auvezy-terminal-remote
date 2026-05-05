/**
 * TerminalView
 *
 * 终端容器，极薄壳。所有逻辑都在 useTerminal 里。
 */

import { forwardRef } from 'react';
import clsx from 'clsx';
import s from './TerminalView.module.scss';

export interface TerminalViewProps {
  className?: string;
}

export const TerminalView = forwardRef<HTMLDivElement, TerminalViewProps>(
  function TerminalView({ className }, ref) {
    return <div id="terminal-view" ref={ref} className={clsx(s.root, className)} />;
  },
);
