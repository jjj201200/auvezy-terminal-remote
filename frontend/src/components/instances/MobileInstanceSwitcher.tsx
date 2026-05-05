/**
 * MobileInstanceSwitcher
 *
 * 移动端：右上角按钮 = 当前实例名 + 切换图标。
 * 点击打开底部 sheet 列出全部实例 + 创建按钮。
 */

import { useState, type JSX } from 'react';
import { IconLayoutGrid, IconPlus } from '@tabler/icons-react';
import type { InstanceListItem } from '@otr/shared';
import clsx from 'clsx';
import { Sheet } from '../ui/Sheet.js';
import s from './MobileInstanceSwitcher.module.scss';

export interface MobileInstanceSwitcherProps {
  instances: InstanceListItem[];
  onCreateClick: () => void;
}

export function MobileInstanceSwitcher({
  instances,
  onCreateClick,
}: MobileInstanceSwitcherProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const current = instances.find((i) => i.isCurrent);

  const handleSwitch = (i: InstanceListItem): void => {
    if (i.isCurrent) {
      setOpen(false);
      return;
    }
    window.location.assign(`http://${i.host}:${i.port}/`);
  };

  return (
    <>
      <button
        id="mobile-instance-switcher"
        type="button"
        onClick={() => setOpen(true)}
        className={s.trigger}
        aria-label="切换实例"
      >
        <IconLayoutGrid size={12} stroke={1.5} />
        <span className={s.triggerName}>{current?.name ?? '未命名'}</span>
        <span className={s.triggerPort}>:{current?.port ?? '-'}</span>
      </button>

      <Sheet id="mobile-instance-sheet" open={open} onOpenChange={setOpen} title="实例">
        <div className={s.list}>
          {instances.map((i) => (
            <button
              key={i.instanceId}
              type="button"
              onClick={() => handleSwitch(i)}
              className={clsx(s.item, i.isCurrent && s.itemActive)}
            >
              <div className={s.itemBody}>
                <span className={s.itemName}>{i.name}</span>
                <span className={s.itemCwd}>{i.cwd}</span>
              </div>
              <span className={s.itemPort}>:{i.port}</span>
            </button>
          ))}
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onCreateClick();
            }}
            className={s.create}
          >
            <IconPlus size={14} stroke={1.5} />
            创建新实例
          </button>
        </div>
      </Sheet>
    </>
  );
}
