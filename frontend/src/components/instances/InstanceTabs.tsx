/**
 * InstanceTabs（桌面）
 *
 * 顶部横向标签条 + pending 骨架 tab + 长按菜单（关闭实例）。
 *
 * 设计：
 *  - 真实 instances + pending 列表合并显示
 *  - pending 项不可点击；点击 pending 项弹小 toast 提示"创建中"
 *  - 失败的 pending：显示警告色，点击展示错误信息
 *  - 长按 / 右键真实 tab：弹菜单，含"关闭实例"按钮
 *    - 当前实例（isCurrent）禁用关闭——会让用户自己断开
 */

import { useEffect, useReducer, useRef, useState, type JSX, type PointerEvent as ReactPointerEvent } from 'react';
import { IconPlus, IconLoader2, IconX, IconAlertTriangle, IconRefresh, IconLayoutGrid } from '@tabler/icons-react';
import type { InstanceListItem } from 'auvezy-terminal-remote-shared';
import clsx from 'clsx';
import { useT } from '../../i18n/i18n-context.js';
import { buildInstanceUrl } from '../../services/instance-url.js';
import type { PendingInstance } from '../../hooks/useInstances.js';
import { useHostGroups } from '../../hooks/useHostGroups.js';
import { HostGroupHeader } from './HostGroupHeader.js';
import { MobileInstanceSwitcher } from './MobileInstanceSwitcher.js';
import s from './InstanceTabs.module.scss';

export interface InstanceTabsProps {
  instances: InstanceListItem[];
  /**
   * 当前激活的 tab id（前端 UI 状态；决定 tab 视觉高亮）。
   * 与 InstanceListItem.isCurrent（后端真实"serve webapp 的进程"）是不同概念。
   * 不传 = 不走本地切换语义，回退到 isCurrent 作为高亮（旧行为）
   */
  activeId?: string | null;
  pending?: PendingInstance[];
  onCreateClick: () => void;
  /** 切实例：传了走本地切换；不传 fallback 到 location.assign */
  onSwitch?: (instanceId: string) => void;
  /**
   * 请求关闭某个实例 —— 由父组件接管确认 modal + 实际删除调用。
   * 不传 = 不显示 × 按钮
   */
  onCloseRequest?: (instance: InstanceListItem) => void;
  /** 重新等一个 failed pending（重置超时 + 立即拉一次 list） */
  onPendingRetry?: (pendingId: string) => void;
  /** 关闭一个 pending tab（仅 UI 层移除，不调 DELETE） */
  onPendingDismiss?: (pendingId: string) => void;
  /**
   * "主机管理"按钮（tab 栏最左侧）点击后弹的 sheet 里，详情 modal "断开"按钮的回调。
   * 不传 = 不显示主机管理按钮（向后兼容）
   */
  onDisconnectRequest?: (instance: InstanceListItem) => void;
  /**
   * 主机管理 sheet 受控开关。传了走外部状态（让父级在 create modal 关闭时
   * reopen sheet，形成层级关系）；不传走内部 state（向后兼容）
   */
  manageOpen?: boolean;
  onManageOpenChange?: (open: boolean) => void;
}

const LONG_PRESS_MS = 500;

/**
 * 长按 / 右键菜单总开关。当前菜单为空 → 整个机制禁用，长按和右键都不响应。
 * 未来如果加了菜单项（比如"重启实例" / "复制 URL"），改回 true 即可。
 */
const MENU_ENABLED = false;

export function InstanceTabs({
  instances,
  activeId,
  pending = [],
  onCreateClick,
  onSwitch,
  onCloseRequest,
  onPendingRetry,
  onPendingDismiss,
  onDisconnectRequest,
  manageOpen: manageOpenProp,
  onManageOpenChange,
}: InstanceTabsProps): JSX.Element {
  const t = useT();
  // 主机管理 sheet 开关（tab 栏最左侧按钮触发）
  // 受控 / 非受控双模：传了 manageOpenProp 走外部 state（父级控制 reopen 语义），
  // 否则走内部 state（向后兼容）
  const [internalManageOpen, setInternalManageOpen] = useState(false);
  const manageOpen = manageOpenProp ?? internalManageOpen;
  const setManageOpen = (next: boolean): void => {
    if (onManageOpenChange) onManageOpenChange(next);
    else setInternalManageOpen(next);
  };
  // 长按菜单：哪个实例在显示菜单 + 锚定坐标
  const [menuFor, setMenuFor] = useState<{ id: string; x: number; y: number } | null>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressFiredRef = useRef(false);

  // 点外部关闭菜单
  useEffect(() => {
    if (!menuFor) return;
    const close = (): void => setMenuFor(null);
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', close);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', close);
    };
  }, [menuFor]);

  const cancelLongPress = (): void => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  // 高亮态用 activeId 优先（多实例同页切换场景）；fallback 到 backend isCurrent
  const isHighlight = (i: InstanceListItem): boolean =>
    activeId !== undefined ? i.instanceId === activeId : i.isCurrent;

  const handleSwitch = (i: InstanceListItem): void => {
    if (isHighlight(i)) return; // 已激活，无需切换
    if (longPressFiredRef.current) {
      longPressFiredRef.current = false;
      return;
    }
    if (onSwitch) {
      onSwitch(i.instanceId);
      return;
    }
    window.location.assign(buildInstanceUrl(i.host, i.port));
  };

  const handlePointerDown = (e: ReactPointerEvent<HTMLButtonElement>, i: InstanceListItem): void => {
    if (!MENU_ENABLED) return;
    longPressFiredRef.current = false;
    cancelLongPress();
    const x = e.clientX;
    const y = e.clientY;
    longPressTimer.current = setTimeout(() => {
      longPressFiredRef.current = true;
      setMenuFor({ id: i.instanceId, x, y });
    }, LONG_PRESS_MS);
  };

  const handleContextMenu = (e: React.MouseEvent<HTMLButtonElement>, i: InstanceListItem): void => {
    if (!MENU_ENABLED) return;
    e.preventDefault();
    setMenuFor({ id: i.instanceId, x: e.clientX, y: e.clientY });
  };

  // 关闭按钮 → 上提到父组件做 modal 确认 + 真实 DELETE / killAfterSwitch 跳转
  const handleCloseClick = (i: InstanceListItem): void => {
    onCloseRequest?.(i);
  };

  // host alias 改名后递增 token，让 useHostGroups 重新读 localStorage
  const [aliasTick, bumpAliasTick] = useReducer((n: number) => n + 1, 0);
  const { groups } = useHostGroups(instances, pending, aliasTick);

  const renderInstanceTab = (i: InstanceListItem): JSX.Element => {
    const highlight = isHighlight(i);
    return (
      <div
        key={i.instanceId}
        role="button"
        tabIndex={highlight ? -1 : 0}
        aria-pressed={highlight}
        aria-disabled={highlight}
        onClick={() => handleSwitch(i)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') handleSwitch(i);
        }}
        onPointerDown={(e) =>
          handlePointerDown(
            e as unknown as ReactPointerEvent<HTMLButtonElement>,
            i,
          )
        }
        onPointerUp={cancelLongPress}
        onPointerCancel={cancelLongPress}
        onPointerLeave={cancelLongPress}
        onContextMenu={(e) =>
          handleContextMenu(
            e as unknown as React.MouseEvent<HTMLButtonElement>,
            i,
          )
        }
        title={`${i.cwd} · pid=${i.pid}${i.isCurrent ? ' · 当前服务进程' : ''}`}
        className={clsx(s.tab, highlight && s.tabActive)}
      >
        {onCloseRequest && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              handleCloseClick(i);
            }}
            title={t('instance.close')}
            aria-label={t('instance.close')}
            className={s.tabClose}
          >
            <IconX size={10} stroke={1.5} />
          </button>
        )}
        <span>{i.name}</span>
        <span className={s.tabPort}>:{i.port}</span>
      </div>
    );
  };

  const renderPendingTab = (p: PendingInstance): JSX.Element => {
    const failed = p.state === 'failed';
    return (
      <div
        key={p.pendingId}
        role="button"
        tabIndex={0}
        title={failed ? p.error : t('instance.pendingTooltip')}
        className={clsx(s.tab, s.tabPending, failed && s.tabPendingFailed)}
      >
        {failed ? (
          <IconAlertTriangle size={10} stroke={1.5} />
        ) : (
          <IconLoader2 size={10} stroke={1.5} className={s.spin} />
        )}
        <span className={s.pendingName}>{p.name || t('instance.pendingNameless')}</span>
        {failed && onPendingRetry && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onPendingRetry(p.pendingId);
            }}
            title={t('instance.pendingRetry')}
            aria-label={t('instance.pendingRetry')}
            className={s.tabClose}
          >
            <IconRefresh size={10} stroke={1.5} />
          </button>
        )}
        {failed && onPendingDismiss && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onPendingDismiss(p.pendingId);
            }}
            title={t('instance.pendingDismiss')}
            aria-label={t('instance.pendingDismiss')}
            className={s.tabClose}
          >
            <IconX size={10} stroke={1.5} />
          </button>
        )}
      </div>
    );
  };

  return (
    <nav id="instance-tabs" className={s.nav} aria-label={t('instance.instancesAriaLabel')}>
      {/* 最左侧：主机管理 sheet trigger（点击弹与移动端同款 sheet） */}
      {onDisconnectRequest && (
        <button
          type="button"
          onClick={() => setManageOpen(true)}
          className={s.manage}
          aria-label={t('topBar.manageHosts')}
          title={t('topBar.manageHostsTooltip')}
        >
          <IconLayoutGrid size={12} stroke={1.5} />
        </button>
      )}
      {/* 始终按 host 分段渲染，单 host 也显示 group header（让用户能改别名） */}
      {groups.map((g) => (
        <div key={g.host} className={s.group}>
          <HostGroupHeader
            host={g.host}
            displayName={g.displayName}
            hasAlias={g.hasAlias}
            onRenamed={bumpAliasTick}
          />
          <div className={s.groupTabs}>
            {g.instances.map(renderInstanceTab)}
            {g.pending.map(renderPendingTab)}
          </div>
        </div>
      ))}

      <button
        type="button"
        onClick={onCreateClick}
        title={t('instance.create')}
        aria-label={t('instance.create')}
        className={s.add}
      >
        <IconPlus size={12} stroke={1.5} />
      </button>

      {/*
        长按 / 右键菜单：基础设施保留（事件 + 渲染容器），由 MENU_ENABLED 控制启用。
        当前菜单为空 → MENU_ENABLED=false，整个机制不响应。未来添加菜单项后开回 true
      */}
      {MENU_ENABLED && menuFor && (
        <div
          className={s.menu}
          style={{ left: menuFor.x, top: menuFor.y }}
          onPointerDown={(e) => e.stopPropagation()}
          role="menu"
        />
      )}

      {/* 主机管理 sheet（PC 端复用 MobileInstanceSwitcher 的 sheet body，隐藏其内置 trigger） */}
      {onDisconnectRequest && (
        <MobileInstanceSwitcher
          instances={instances}
          activeId={activeId}
          pending={pending}
          onCreateClick={onCreateClick}
          onSwitch={onSwitch}
          onCloseRequest={onCloseRequest}
          onDisconnectRequest={onDisconnectRequest}
          onPendingRetry={onPendingRetry}
          onPendingDismiss={onPendingDismiss}
          externalOpen={manageOpen}
          onExternalOpenChange={setManageOpen}
          hideTrigger
        />
      )}
    </nav>
  );
}
