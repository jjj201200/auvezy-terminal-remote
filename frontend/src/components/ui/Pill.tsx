/**
 * Pill
 *
 * 状态徽标：圆形胶囊、等宽字体、单色边框；支持多 tone。
 * 用于 StatusBar、实例 tab 内端口号等。
 */

import { type JSX, type ReactNode } from 'react';
import clsx from 'clsx';
import s from './Pill.module.scss';

export type PillTone = 'ok' | 'warn' | 'error' | 'muted' | 'accent';

export interface PillProps {
  tone?: PillTone;
  children: ReactNode;
  className?: string;
  /**
   * 紧凑模式：只显示圆点，文字隐藏（仍对屏幕阅读器可见）。
   * 状态含义靠外层 title / aria-label 暴露给悬停 / 长按用户。
   * 用于移动端窄屏顶栏。
   */
  compact?: boolean;
}

const TONE_CLASS: Record<PillTone, string> = {
  ok: s.toneOk!,
  warn: s.toneWarn!,
  error: s.toneError!,
  muted: s.toneMuted!,
  accent: s.toneAccent!,
};

export function Pill({ tone = 'muted', children, className, compact }: PillProps): JSX.Element {
  return (
    <span className={clsx(s.root, TONE_CLASS[tone], compact && s.compact, className)}>
      {compact ? <span>{children}</span> : children}
    </span>
  );
}
