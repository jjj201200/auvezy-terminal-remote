/**
 * MobileInstanceSwitcher
 *
 * 移动端：右上角按钮 = 当前实例名 + 切换图标。
 * 点击打开底部 sheet 列出全部实例 + 创建按钮。
 */

import { useState, type JSX } from 'react';
import { IconLayoutGrid, IconPlus, IconX } from '@tabler/icons-react';
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
  /** 关闭实例 */
  onClose?: (instanceId: string) => Promise<string | null>;
}

export function MobileInstanceSwitcher({
  instances,
  onCreateClick,
  onSwitch,
  onClose,
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
            // 用 div 容器：button 不能嵌 button（关闭按钮在内部）
            <div
              key={i.instanceId}
              role="button"
              tabIndex={i.isCurrent ? -1 : 0}
              onClick={() => handleSwitch(i)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') handleSwitch(i);
              }}
              aria-pressed={i.isCurrent}
              aria-disabled={i.isCurrent}
              className={clsx(s.item, i.isCurrent && s.itemActive)}
            >
              <div className={s.itemBody}>
                <span className={s.itemName}>{i.name}</span>
                <span className={s.itemCwd}>{i.cwd}</span>
              </div>
              <span className={s.itemPort}>:{i.port}</span>
              {onClose && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (i.isCurrent) {
                      const others = instances.filter((x) => x.instanceId !== i.instanceId);
                      if (others.length === 0) {
                        alert(t('instance.closeCurrentLast'));
                        return;
                      }
                      if (!confirm(t('instance.closeCurrentConfirm', { name: i.name }))) return;
                      const target = others[0]!;
                      const url = new URL(
                        buildInstanceUrl(target.host, target.port),
                        window.location.href,
                      );
                      url.searchParams.set('killAfterSwitch', i.instanceId);
                      window.location.assign(url.toString());
                      return;
                    }
                    if (!confirm(t('instance.closeConfirm', { name: i.name }))) return;
                    void onClose(i.instanceId).then((err) => {
                      if (err) alert(`${t('instance.closeFailed')}: ${err}`);
                    });
                  }}
                  aria-label={t('instance.close')}
                  title={t('instance.close')}
                  className={s.itemClose}
                >
                  <IconX size={12} stroke={1.5} />
                </button>
              )}
            </div>
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
