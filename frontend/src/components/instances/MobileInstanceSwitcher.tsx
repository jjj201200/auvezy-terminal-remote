/**
 * MobileInstanceSwitcher
 *
 * 移动端：右上角按钮 = 当前实例名 + 切换图标。
 * 点击打开底部 sheet 列出全部实例 + 创建按钮。
 */

import { useState, type JSX } from 'react';
import {
  IconLayoutGrid,
  IconPlus,
  IconX,
  IconLoader2,
  IconAlertTriangle,
  IconRefresh,
} from '@tabler/icons-react';
import type { InstanceListItem } from '@auvezy/terminal-remote-shared';
import clsx from 'clsx';
import { Sheet } from '../ui/Sheet.js';
import { useT } from '../../i18n/i18n-context.js';
import { buildInstanceUrl } from '../../services/instance-url.js';
import type { PendingInstance } from '../../hooks/useInstances.js';
import s from './MobileInstanceSwitcher.module.scss';

export interface MobileInstanceSwitcherProps {
  instances: InstanceListItem[];
  /** 当前激活 tab id（前端 UI 状态；与 isCurrent 是不同概念） */
  activeId?: string | null;
  pending?: PendingInstance[];
  onCreateClick: () => void;
  /** 自定义切换：传了走本地切换；不传 fallback 到 location.assign */
  onSwitch?: (instanceId: string) => void;
  /** 请求关闭实例 —— 父组件接管 modal 确认 + 真实删除 */
  onCloseRequest?: (instance: InstanceListItem) => void;
  /** 重新等一个 failed pending */
  onPendingRetry?: (pendingId: string) => void;
  /** 关闭一个 pending tab（仅 UI 层移除） */
  onPendingDismiss?: (pendingId: string) => void;
}

export function MobileInstanceSwitcher({
  instances,
  activeId,
  pending = [],
  onCreateClick,
  onSwitch,
  onCloseRequest,
  onPendingRetry,
  onPendingDismiss,
}: MobileInstanceSwitcherProps): JSX.Element {
  const t = useT();
  const [open, setOpen] = useState(false);

  const isHighlight = (i: InstanceListItem): boolean =>
    activeId !== undefined ? i.instanceId === activeId : i.isCurrent;
  const active = instances.find((i) => isHighlight(i));

  const handleSwitch = (i: InstanceListItem): void => {
    if (isHighlight(i)) {
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
        <span className={s.triggerName}>{active?.name ?? t('shortcuts.unnamed')}</span>
        <span className={s.triggerPort}>:{active?.port ?? '-'}</span>
      </button>

      <Sheet id="mobile-instance-sheet" open={open} onOpenChange={setOpen} title={t('instance.sheetTitle')}>
        <div className={s.list}>
          {instances.map((i) => {
            const highlight = isHighlight(i);
            return (
            // 用 div 容器：button 不能嵌 button（关闭按钮在内部）
            <div
              key={i.instanceId}
              role="button"
              tabIndex={highlight ? -1 : 0}
              onClick={() => handleSwitch(i)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') handleSwitch(i);
              }}
              aria-pressed={highlight}
              aria-disabled={highlight}
              className={clsx(s.item, highlight && s.itemActive)}
            >
              <div className={s.itemBody}>
                <span className={s.itemName}>{i.name}</span>
                <span className={s.itemCwd}>{i.cwd}</span>
              </div>
              <span className={s.itemPort}>:{i.port}</span>
              {onCloseRequest && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onCloseRequest(i);
                    setOpen(false);
                  }}
                  aria-label={t('instance.close')}
                  title={t('instance.close')}
                  className={s.itemClose}
                >
                  <IconX size={12} stroke={1.5} />
                </button>
              )}
            </div>
            );
          })}
          {pending.map((p) => {
            const failed = p.state === 'failed';
            return (
              <div
                key={p.pendingId}
                role="button"
                tabIndex={0}
                title={failed ? p.error : t('instance.pendingTooltip')}
                className={clsx(s.item, s.itemPending, failed && s.itemPendingFailed)}
              >
                {failed ? (
                  <IconAlertTriangle size={12} stroke={1.5} />
                ) : (
                  <IconLoader2 size={12} stroke={1.5} className={s.spin} />
                )}
                <div className={s.itemBody}>
                  <span className={s.itemName}>
                    {p.name || t('instance.pendingNameless')}
                  </span>
                  {failed && p.error && <span className={s.itemCwd}>{p.error}</span>}
                </div>
                {failed && onPendingRetry && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onPendingRetry(p.pendingId);
                    }}
                    aria-label={t('instance.pendingRetry')}
                    title={t('instance.pendingRetry')}
                    className={s.itemClose}
                  >
                    <IconRefresh size={12} stroke={1.5} />
                  </button>
                )}
                {failed && onPendingDismiss && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onPendingDismiss(p.pendingId);
                    }}
                    aria-label={t('instance.pendingDismiss')}
                    title={t('instance.pendingDismiss')}
                    className={s.itemClose}
                  >
                    <IconX size={12} stroke={1.5} />
                  </button>
                )}
              </div>
            );
          })}
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
