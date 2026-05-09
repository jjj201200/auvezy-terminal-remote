/**
 * MobileInstanceSwitcher
 *
 * 移动端：右上角按钮 = 当前实例名 + 切换图标。
 * 点击打开底部 sheet 列出全部实例 + 创建按钮。
 *
 * 卡片交互：
 *  - 点击卡片主体 → 弹 InstanceDetailModal（看完整 cwd / host / port + 4 个动作）
 *  - 卡片右侧切换图标按钮 → 直接切换到该实例（保留快捷路径）
 *  - 关闭实例的二次确认仍走父组件 onCloseRequest（保持现有 ConfirmModal 流程）
 */

import { useReducer, useState, type JSX } from 'react';
import {
  IconLayoutGrid,
  IconPlus,
  IconX,
  IconArrowsExchange,
  IconLoader2,
  IconAlertTriangle,
  IconRefresh,
} from '@tabler/icons-react';
import type { InstanceListItem } from 'auvezy-terminal-remote-shared';
import clsx from 'clsx';
import { Sheet } from '../ui/Sheet.js';
import { useT } from '../../i18n/i18n-context.js';
import { buildInstanceUrl } from '../../services/instance-url.js';
import type { PendingInstance } from '../../hooks/useInstances.js';
import { useHostGroups } from '../../hooks/useHostGroups.js';
import { HostGroupHeader } from './HostGroupHeader.js';
import { InstanceDetailModal } from './InstanceDetailModal.js';
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
  /** 详情 modal 里"断开"按钮：父组件持有真实 disconnect 函数 */
  onDisconnectRequest?: (instance: InstanceListItem) => void;
  /** 重新等一个 failed pending */
  onPendingRetry?: (pendingId: string) => void;
  /** 关闭一个 pending tab（仅 UI 层移除） */
  onPendingDismiss?: (pendingId: string) => void;
  /**
   * 外部控制 sheet 开关（PC 端 InstanceTabs 用：trigger 在 tab 栏左侧，由它控制）
   * 不传 = 使用内部默认 trigger（移动端原行为）
   */
  externalOpen?: boolean;
  onExternalOpenChange?: (open: boolean) => void;
  /** PC 端复用本组件的 sheet 但不渲染移动端的 trigger 按钮 */
  hideTrigger?: boolean;
}

export function MobileInstanceSwitcher({
  instances,
  activeId,
  pending = [],
  onCreateClick,
  onSwitch,
  onCloseRequest,
  onDisconnectRequest,
  onPendingRetry,
  onPendingDismiss,
  externalOpen,
  onExternalOpenChange,
  hideTrigger = false,
}: MobileInstanceSwitcherProps): JSX.Element {
  const t = useT();
  const [internalOpen, setInternalOpen] = useState(false);
  // 受控 / 非受控双模：传 externalOpen 走受控（PC 用），否则走内部 state（移动端原行为）
  const open = externalOpen ?? internalOpen;
  const setOpen = (next: boolean): void => {
    if (onExternalOpenChange) onExternalOpenChange(next);
    else setInternalOpen(next);
  };
  const [detailFor, setDetailFor] = useState<InstanceListItem | null>(null);
  const [aliasTick, bumpAliasTick] = useReducer((n: number) => n + 1, 0);
  const { groups } = useHostGroups(instances, pending, aliasTick);

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

  const closeDetail = (): void => setDetailFor(null);

  const renderInstanceItem = (i: InstanceListItem): JSX.Element => {
    const highlight = isHighlight(i);
    return (
      // div 容器：button 不能嵌 button；主体点 → 详情 modal，右侧切换按钮 → 直接跳
      <div
        key={i.instanceId}
        role="button"
        tabIndex={0}
        onClick={() => setDetailFor(i)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') setDetailFor(i);
        }}
        aria-pressed={highlight}
        aria-label={t('instance.switchAriaLabel')}
        className={clsx(s.item, highlight && s.itemActive)}
      >
        <div className={s.itemBody}>
          <span className={s.itemName}>{i.name}</span>
          {/* cwd 完整显示，长路径折行而不省略；详情 modal 也会再看一次但这里
              用户先看到全文，避免"还要点开才知道工作在哪" */}
          <span className={s.itemCwd}>{i.cwd}</span>
        </div>
        <span className={s.itemPort}>:{i.port}</span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            handleSwitch(i);
          }}
          aria-label={highlight ? t('instance.detailSwitchAlready') : t('instance.detailSwitch')}
          title={highlight ? t('instance.detailSwitchAlready') : t('instance.detailSwitch')}
          disabled={highlight}
          className={s.itemSwitch}
        >
          <IconArrowsExchange size={14} stroke={1.5} />
        </button>
      </div>
    );
  };

  const renderPendingItem = (p: PendingInstance): JSX.Element => {
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
  };

  return (
    <>
      {!hideTrigger && (
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
      )}

      <Sheet id="mobile-instance-sheet" open={open} onOpenChange={setOpen} title={t('instance.sheetTitle')}>
        <div className={s.list}>
          {groups.map((g) => (
            <div key={g.host} className={s.hostSection}>
              <HostGroupHeader
                host={g.host}
                displayName={g.displayName}
                hasAlias={g.hasAlias}
                onRenamed={bumpAliasTick}
                compact
              />
              {g.instances.map((i) => renderInstanceItem(i))}
              {g.pending.map((p) => renderPendingItem(p))}
            </div>
          ))}
          <button
            type="button"
            onClick={() => {
              // 不在这里关 sheet —— 让父级 onCreateClick 决定（外部受控时
              // 父级会 setManageOpen(false) 并记录 reopenOnClose；内部受控
              // 由 onCreateClick 之后保持 sheet 不变也可，但传统行为是关闭）
              onCreateClick();
            }}
            className={s.create}
          >
            <IconPlus size={14} stroke={1.5} />
            {t('instance.create')}
          </button>
        </div>
      </Sheet>

      <InstanceDetailModal
        open={detailFor !== null}
        instance={detailFor}
        isActive={detailFor ? isHighlight(detailFor) : false}
        onClose={closeDetail}
        onSwitch={() => {
          if (detailFor) handleSwitch(detailFor);
          closeDetail();
        }}
        onDisconnect={() => {
          if (detailFor && onDisconnectRequest) onDisconnectRequest(detailFor);
          closeDetail();
          setOpen(false);
        }}
        onCloseInstance={() => {
          // 关掉详情先，让父组件的 ConfirmModal（二次确认）能盖在最上层
          // 否则两层 modal 叠加视觉混乱 + Sheet 焦点抢夺
          const target = detailFor;
          closeDetail();
          setOpen(false);
          if (target && onCloseRequest) onCloseRequest(target);
        }}
      />
    </>
  );
}
