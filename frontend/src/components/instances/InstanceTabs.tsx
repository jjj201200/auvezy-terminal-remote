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

import { useEffect, useRef, useState, type JSX, type PointerEvent as ReactPointerEvent } from 'react';
import { IconPlus, IconLoader2, IconX, IconAlertTriangle } from '@tabler/icons-react';
import type { InstanceListItem } from '@otr/shared';
import clsx from 'clsx';
import { useT } from '../../i18n/i18n-context.js';
import { buildInstanceUrl } from '../../services/instance-url.js';
import type { PendingInstance } from '../../hooks/useInstances.js';
import s from './InstanceTabs.module.scss';

export interface InstanceTabsProps {
  instances: InstanceListItem[];
  pending?: PendingInstance[];
  onCreateClick: () => void;
  /** 切实例：传了走本地切换；不传 fallback 到 location.assign */
  onSwitch?: (instanceId: string) => void;
  /** 关闭实例（DELETE /api/instances/:id）；返回 null 成功，否则错误信息 */
  onClose?: (instanceId: string) => Promise<string | null>;
}

const LONG_PRESS_MS = 500;

/**
 * 长按 / 右键菜单总开关。当前菜单为空 → 整个机制禁用，长按和右键都不响应。
 * 未来如果加了菜单项（比如"重启实例" / "复制 URL"），改回 true 即可。
 */
const MENU_ENABLED = false;

export function InstanceTabs({
  instances,
  pending = [],
  onCreateClick,
  onSwitch,
  onClose,
}: InstanceTabsProps): JSX.Element {
  const t = useT();
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

  const handleSwitch = (i: InstanceListItem): void => {
    if (i.isCurrent) return;
    if (longPressFiredRef.current) {
      // 长按已经弹了菜单，不走切换
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

  const handleCloseClick = (i: InstanceListItem): void => {
    if (!onClose) return;
    // isCurrent = serve 这个 webapp 的进程。关它会让本设备的整个 webapp 立刻
    // "失去地基"（刷新就 404）+ 把其他正连这个 origin 的设备一并踢下线。
    //
    // 流程：先跳到另一个实例的 origin（带 token），新前端 mount 时通过
    // ?killAfterSwitch=<oldId> query 发 DELETE 关掉老 isCurrent。
    if (i.isCurrent) {
      const others = instances.filter((x) => x.instanceId !== i.instanceId);
      if (others.length === 0) {
        alert(t('instance.closeCurrentLast'));
        return;
      }
      if (!confirm(t('instance.closeCurrentConfirm', { name: i.name }))) return;
      // 选一个目标实例（优先非 pending 的，第一个即可）
      const target = others[0]!;
      const url = new URL(buildInstanceUrl(target.host, target.port), window.location.href);
      url.searchParams.set('killAfterSwitch', i.instanceId);
      window.location.assign(url.toString());
      return;
    }
    if (!confirm(t('instance.closeConfirm', { name: i.name }))) return;
    void onClose(i.instanceId).then((err) => {
      if (err) alert(`${t('instance.closeFailed')}: ${err}`);
    });
  };

  return (
    <nav id="instance-tabs" className={s.nav} aria-label={t('instance.instancesAriaLabel')}>
      {instances.map((i) => (
        // 用 div role=button：内部要嵌关闭按钮（button 不能嵌 button）
        // 整个 div 为切换实例的命中区，关闭 × 只占 tab 右侧一小块
        <div
          key={i.instanceId}
          role="button"
          tabIndex={i.isCurrent ? -1 : 0}
          aria-pressed={i.isCurrent}
          aria-disabled={i.isCurrent}
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
          title={`${i.cwd} · pid=${i.pid}`}
          className={clsx(s.tab, i.isCurrent && s.tabActive)}
        >
          <span>{i.name}</span>
          <span className={s.tabPort}>:{i.port}</span>
          {onClose && (
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
        </div>
      ))}
      {pending.map((p) => (
        <button
          key={p.pendingId}
          type="button"
          onClick={() => {
            if (p.state === 'failed' && p.error) {
              alert(`${t('instance.pendingFailed')}: ${p.error}`);
            }
          }}
          title={p.state === 'failed' ? p.error : t('instance.pendingTooltip')}
          className={clsx(s.tab, s.tabPending, p.state === 'failed' && s.tabPendingFailed)}
        >
          {p.state === 'creating' ? (
            <IconLoader2 size={10} stroke={1.5} className={s.spin} />
          ) : (
            <IconAlertTriangle size={10} stroke={1.5} />
          )}
          <span className={s.pendingName}>{p.name || t('instance.pendingNameless')}</span>
        </button>
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
    </nav>
  );
}
