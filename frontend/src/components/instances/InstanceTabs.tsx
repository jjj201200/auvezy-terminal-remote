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
    // 桌面右键 = 直接弹菜单（无需等长按）
    e.preventDefault();
    setMenuFor({ id: i.instanceId, x: e.clientX, y: e.clientY });
  };

  return (
    <nav id="instance-tabs" className={s.nav} aria-label={t('instance.instancesAriaLabel')}>
      {instances.map((i) => (
        <button
          key={i.instanceId}
          type="button"
          onClick={() => handleSwitch(i)}
          onPointerDown={(e) => handlePointerDown(e, i)}
          onPointerUp={cancelLongPress}
          onPointerCancel={cancelLongPress}
          onPointerLeave={cancelLongPress}
          onContextMenu={(e) => handleContextMenu(e, i)}
          title={`${i.cwd} · pid=${i.pid}`}
          disabled={i.isCurrent}
          className={clsx(s.tab, i.isCurrent && s.tabActive)}
        >
          <span>{i.name}</span>
          <span className={s.tabPort}>:{i.port}</span>
        </button>
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

      {menuFor && (
        <div
          className={s.menu}
          style={{ left: menuFor.x, top: menuFor.y }}
          onPointerDown={(e) => e.stopPropagation()}
          role="menu"
        >
          <button
            type="button"
            className={s.menuItem}
            disabled={!onClose || instances.find((i) => i.instanceId === menuFor.id)?.isCurrent}
            onClick={async () => {
              const id = menuFor.id;
              setMenuFor(null);
              if (!onClose) return;
              const err = await onClose(id);
              if (err) alert(`${t('instance.closeFailed')}: ${err}`);
            }}
          >
            <IconX size={12} stroke={1.5} />
            {t('instance.close')}
          </button>
        </div>
      )}
    </nav>
  );
}
