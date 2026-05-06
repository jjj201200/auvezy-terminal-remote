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
import { useT } from '../../i18n/i18n-context.js';
import { buildInstanceUrl } from '../../services/instance-url.js';
import s from './MobileInstanceSwitcher.module.scss';

export interface MobileInstanceSwitcherProps {
  instances: InstanceListItem[];
  onCreateClick: () => void;
  /** 自定义切换：传了走本地切换；不传 fallback 到 location.assign */
  onSwitch?: (instanceId: string) => void;
}

export function MobileInstanceSwitcher({
  instances,
  onCreateClick,
  onSwitch,
}: MobileInstanceSwitcherProps): JSX.Element {
  const t = useT();
  const [open, setOpen] = useState(false);
  const current = instances.find((i) => i.isCurrent);

  const handleSwitch = (i: InstanceListItem): void => {
    if (i.isCurrent) {
      setOpen(false);
      return;
    }
    if (onSwitch) {
      onSwitch(i.instanceId);
      setOpen(false);
      return;
    }
    window.location.assign(buildInstanceUrl(i.host, i.port));
  };

  return (
    <>
      <button
        id="mobile-instance-switcher"
        type="button"
        onClick={() => setOpen(true)}
        className={s.trigger}
        aria-label={t('topBar.switchInstance')}
      >
        <IconLayoutGrid size={12} stroke={1.5} />
        <span className={s.triggerName}>{current?.name ?? t('shortcuts.unnamed')}</span>
        <span className={s.triggerPort}>:{current?.port ?? '-'}</span>
      </button>

      <Sheet id="mobile-instance-sheet" open={open} onOpenChange={setOpen} title={t('instance.sheetTitle')}>
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
            {t('instance.create')}
          </button>
        </div>
      </Sheet>
    </>
  );
}
