/**
 * InstanceTabs
 *
 * 顶部标签条：每个实例一个 tab，点击非当前实例 → window.location 跳转到该实例。
 *
 * 设计：
 *  - 跨实例 = 跨端口 = 跨 origin → 必须用 location.assign 而不是 react-router
 *  - 跳转 URL 不带 ?token：用户已经登录过的实例由 cookie 维持；
 *    没登录的实例靠 useAuth 的本地缓存 token 自动重认证
 *  - 「+」按钮触发 onCreateClick（外层弹 CreateInstanceModal）
 *  - 当前实例不可点击（视觉上 active）
 */

import { type JSX } from 'react';
import type { InstanceListItem } from '@ocr/shared';

export interface InstanceTabsProps {
  instances: InstanceListItem[];
  /** 点 + 时调用 */
  onCreateClick: () => void;
}

export function InstanceTabs({ instances, onCreateClick }: InstanceTabsProps): JSX.Element {
  const handleSwitch = (i: InstanceListItem): void => {
    if (i.isCurrent) return;
    // 跨端口跳转；同 host
    const url = `http://${i.host}:${i.port}/`;
    window.location.assign(url);
  };

  return (
    <nav className="instance-tabs" aria-label="实例切换">
      {instances.map((i) => (
        <button
          key={i.instanceId}
          type="button"
          className={`instance-tab ${i.isCurrent ? 'instance-tab--active' : ''}`}
          onClick={() => handleSwitch(i)}
          title={`${i.cwd} · pid=${i.pid}`}
          disabled={i.isCurrent}
        >
          <span className="instance-tab__name">{i.name}</span>
          <span className="instance-tab__port">:{i.port}</span>
        </button>
      ))}
      <button
        type="button"
        className="instance-tab instance-tab--create"
        onClick={onCreateClick}
        title="创建新实例"
        aria-label="创建新实例"
      >
        +
      </button>
    </nav>
  );
}
