/**
 * Toggle
 *
 * Radix Switch 的极薄包装：受控 checked + onCheckedChange + 可选 label。
 */

import { type JSX } from 'react';
import * as Switch from '@radix-ui/react-switch';
import { cn } from '../../utils/cn.js';

export interface ToggleProps {
  checked: boolean;
  onCheckedChange: (next: boolean) => void;
  label?: string;
  disabled?: boolean;
  className?: string;
}

export function Toggle({
  checked,
  onCheckedChange,
  label,
  disabled,
  className,
}: ToggleProps): JSX.Element {
  return (
    <label
      className={cn(
        'inline-flex items-center gap-2 text-xs text-[var(--color-fg-muted)]',
        className,
      )}
    >
      <Switch.Root
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        className={cn(
          'relative h-[18px] w-[30px] rounded-full border border-[var(--color-border)] bg-[var(--color-bg)] transition-colors',
          'data-[state=checked]:bg-[var(--color-accent)] data-[state=checked]:border-[var(--color-accent)]',
          'disabled:opacity-40',
        )}
      >
        <Switch.Thumb
          className={cn(
            'block h-[12px] w-[12px] translate-x-[2px] rounded-full bg-[var(--color-fg-muted)] transition-transform',
            'data-[state=checked]:translate-x-[14px] data-[state=checked]:bg-white',
          )}
        />
      </Switch.Root>
      {label && <span>{label}</span>}
    </label>
  );
}
