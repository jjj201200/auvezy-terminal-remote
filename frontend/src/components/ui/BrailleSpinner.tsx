/**
 * BrailleSpinner — 终端式 Braille 字符旋转 spinner
 *
 * 用 React state 每 100ms 切一帧(8 帧循环),mono 字体 + 项目 accent 色(磷光绿)
 * + phosphor-glow 阴影。比 SVG 旋转圈更贴合项目终端美学。
 *
 * 多处共享:文件列表 loading、文件预览 loading、Suspense fallback 等。
 *
 * size:
 *  - 'sm' = 16px(行内文案旁的小 spinner,如 "Loading…" 前缀)
 *  - 'md' = 20px(默认,FileBrowser 列表中央等位)
 *  - 'lg' = 28px(MarkdownPreview / 大区域居中状态)
 *
 * 用法:
 *   <BrailleSpinner />                          // 默认 md
 *   <BrailleSpinner size="lg" />
 *   <BrailleSpinner label="加载中..." />        // 带文字标签(spinner 在左)
 *
 * a11y:不接 label 时 aria-hidden;接 label 时容器 role="status" + aria-live。
 */

import { useEffect, useState, type JSX } from 'react';
import s from './BrailleSpinner.module.scss';

const BRAILLE_FRAMES = ['⣾', '⣽', '⣻', '⢿', '⡿', '⣟', '⣯', '⣷'] as const;

const FRAME_INTERVAL_MS = 100;

export interface BrailleSpinnerProps {
  /** spinner 字号档 — sm/md/lg */
  size?: 'sm' | 'md' | 'lg';
  /** 可选文字标签;给了 → 显示在 spinner 右侧 + 容器走 role="status" */
  label?: string;
  /** 自定义 className 给外层容器(spinner + label 整体) */
  className?: string;
}

export function BrailleSpinner({
  size = 'md',
  label,
  className,
}: BrailleSpinnerProps): JSX.Element {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => {
      setFrame((f) => (f + 1) % BRAILLE_FRAMES.length);
    }, FRAME_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, []);

  const spinner = (
    <span
      className={`${s.spinner} ${s[`size_${size}`]}`}
      aria-hidden={label ? undefined : true}
    >
      {BRAILLE_FRAMES[frame]}
    </span>
  );

  if (!label) return spinner;

  return (
    <span
      className={`${s.withLabel} ${className ?? ''}`}
      role="status"
      aria-live="polite"
    >
      {spinner}
      <span className={s.label}>{label}</span>
    </span>
  );
}
