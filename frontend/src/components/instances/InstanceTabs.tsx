/**
 * InstanceTabs（桌面）
 *
 * 顶部横向标签条；每个实例一个 tab；点击非当前实例 → location.assign。
 * 「+」按钮触发 onCreateClick。移动端不渲染（用 MobileInstanceSwitcher）。
 */

import { type JSX } from 'react';
import { IconPlus } from '@tabler/icons-react';
import type { InstanceListItem } from '@otr/shared';
import clsx from 'clsx';
import s from './InstanceTabs.module.scss';

export interface InstanceTabsProps {
  instances: InstanceListItem[];
  onCreateClick: () => void;
}

export function InstanceTabs({ instances, onCreateClick }: InstanceTabsProps): JSX.Element {
  const handleSwitch = (i: InstanceListItem): void => {
    if (i.isCurrent) return;
    window.location.assign(`http://${i.host}:${i.port}/`);
  };

  return (
    <nav id="instance-tabs" className={s.nav} aria-label="实例切换">
      {instances.map((i) => (
        <button
          key={i.instanceId}
          type="button"
          onClick={() => handleSwitch(i)}
          title={`${i.cwd} · pid=${i.pid}`}
          disabled={i.isCurrent}
          className={clsx(s.tab, i.isCurrent && s.tabActive)}
        >
          <span>{i.name}</span>
          <span className={s.tabPort}>:{i.port}</span>
        </button>
      ))}
      <button
        type="button"
        onClick={onCreateClick}
        title="创建新实例"
        aria-label="创建新实例"
        className={s.add}
      >
        <IconPlus size={12} stroke={1.5} />
      </button>
    </nav>
  );
}
