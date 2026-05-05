/**
 * className 拼接：clsx 的薄壳
 *
 * 用法：cn('btn', isActive && 'btn-active', { 'btn-disabled': disabled })
 */

import { clsx, type ClassValue } from 'clsx';

export function cn(...inputs: ClassValue[]): string {
  return clsx(inputs);
}
