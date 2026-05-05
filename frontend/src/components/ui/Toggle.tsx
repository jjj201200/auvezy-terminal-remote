/**
 * Toggle
 *
 * Radix Switch 的极薄包装：受控 checked + onCheckedChange + 可选 label。
 */

import { type JSX } from 'react';
import * as Switch from '@radix-ui/react-switch';
import clsx from 'clsx';
import s from './Toggle.module.scss';

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
    <label className={clsx(s.label, disabled && s.disabled, className)}>
      <Switch.Root
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        className={s.root}
      >
        <Switch.Thumb className={s.thumb} />
      </Switch.Root>
      {label && <span className={s.text}>{label}</span>}
    </label>
  );
}
