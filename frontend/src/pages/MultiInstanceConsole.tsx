/**
 * MultiInstanceConsole
 *
 * 多实例控制台：渲染顶栏 + 所有实例的 InstanceView（CSS 切显示）+ 共享 modals。
 *
 * 关键设计：
 *  - 所有 InstanceView 始终挂载，通过 active 标记切换 display:none/flex
 *    → WS 持续连着、xterm 持续接收数据，切回来无需 history_sync 等待
 *  - 单 origin（用户首次访问的那个实例的页面）：
 *    当前实例（origin = location.host）的 WS 用同源默认 /ws
 *    其他实例的 WS 用 ws://otherHost:otherPort/ws?token=<localStorage 的 token>
 *  - 顶栏 InstanceTabs / StatusBar / 三个 IconButton 是共享的，
 *    显示的状态来自当前 active 实例
 *  - settings / share / create / search modal 都是单例，跨实例共用
 */

import { useCallback, useEffect, useMemo, useState, type JSX } from 'react';
import { IconSearch, IconSettings, IconShare2 } from '@tabler/icons-react';
import type { SessionStatus } from '@otr/shared';
import { useUserConfig } from '../hooks/useUserConfig.js';
import { useInstances } from '../hooks/useInstances.js';
import { useMediaQuery } from '../hooks/useMediaQuery.js';
import { useT } from '../i18n/i18n-context.js';
import type { ConnectionStatus } from '../stores/app-store.js';
import { StatusBar } from '../components/status/StatusBar.js';
import { SettingsModal } from '../components/settings/SettingsModal.js';
import { InstanceTabs } from '../components/instances/InstanceTabs.js';
import { MobileInstanceSwitcher } from '../components/instances/MobileInstanceSwitcher.js';
import { CreateInstanceModal } from '../components/instances/CreateInstanceModal.js';
import { ShareSheet } from '../components/share/ShareSheet.js';
import { InstanceView } from '../components/instances/InstanceView.js';
import { IconButton } from '../components/ui/IconButton.js';
import { loadToken } from '../services/token-storage.js';
import s from './ConsolePage.module.scss';

interface InstanceStatus {
  connection: ConnectionStatus;
  session: SessionStatus;
}

export function MultiInstanceConsole(): JSX.Element {
  const t = useT();
  const isMobile = useMediaQuery('(max-width: 767px)');
  const { config, save } = useUserConfig();
  const { instances, pending, create: createInstance, remove: rawRemoveInstance } = useInstances();

  // 关闭实例的包装：成功且没有别的实例了 → 弹出"创建实例"modal，
  // 让用户立刻有路可走（前端 token 已存，新实例创建后能直接用）
  const removeInstance = useCallback(
    async (instanceId: string): Promise<string | null> => {
      const err = await rawRemoveInstance(instanceId);
      if (err === null) {
        const remaining = instances.filter((i) => i.instanceId !== instanceId);
        if (remaining.length === 0) {
          setCreateOpen(true);
        }
      }
      return err;
    },
    [rawRemoveInstance, instances],
  );

  // killAfterSwitch：用户从老 isCurrent 实例 × 跳转过来时，URL 上带的老 instanceId。
  // 这边新前端 mount 后立即 DELETE 它，并清掉 URL 参数。
  // useAuth 已经处理了 URL ?token= 自动登录，这里只管 kill 那一步
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const killId = params.get('killAfterSwitch');
    // eslint-disable-next-line no-console
    console.warn('[killAfterSwitch] effect fired', { killId, search: window.location.search });
    if (!killId) return;
    params.delete('killAfterSwitch');
    const newSearch = params.toString();
    const newUrl =
      window.location.pathname + (newSearch ? `?${newSearch}` : '') + window.location.hash;
    window.history.replaceState(null, '', newUrl);
    void rawRemoveInstance(killId).then((err) => {
      // eslint-disable-next-line no-console
      console.warn('[killAfterSwitch] DELETE result', { killId, err });
    });
  }, [rawRemoveInstance]);

  // 共享 modal 开关
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  // 当前 active 实例 id；首次默认 = 当前服务进程标记 isCurrent 的那个
  const [activeId, setActiveId] = useState<string | null>(null);

  // 各实例状态映射：activeId 对应的状态会显示在顶栏 StatusBar
  const [statusMap, setStatusMap] = useState<Record<string, InstanceStatus>>({});

  // active 实例的 reconnect 回调（StatusBar 点击重连用）
  const [reconnectFn, setReconnectFn] = useState<(() => void) | null>(null);

  // 默认选中：优先 isCurrent，回退第一个
  // active 实例消失（被关闭 / 进程死亡）时也走这条：自动选当前服务进程对应实例
  useEffect(() => {
    if (activeId && instances.some((i) => i.instanceId === activeId)) return;
    const cur = instances.find((i) => i.isCurrent) ?? instances[0];
    setActiveId(cur?.instanceId ?? null);
  }, [instances, activeId]);

  // 全局 Cmd+F：toggle SearchBar（active 实例处理实际搜索）
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setSearchOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // 拦截 InstanceTabs 的切换：直接改 active state，不再 location.assign
  // 这里不能改原 InstanceTabs 的 handleSwitch（它跳转 URL）——传 onSwitch 让它优先用
  // ……但 InstanceTabs 现在是 location.assign。我们改它支持可选 onSwitch
  const handleSwitch = useCallback((instanceId: string) => {
    setActiveId(instanceId);
  }, []);

  // 给每个实例算 wsUrl：当前 origin 命中的实例传 undefined（同源 /ws）
  const buildWsUrl = useCallback((host: string, port: number): string | undefined => {
    const sameHost = window.location.hostname === host;
    const samePort = String(window.location.port || (window.location.protocol === 'https:' ? 443 : 80)) === String(port);
    if (sameHost && samePort) return undefined; // 同源默认
    const token = loadToken();
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const hostPart = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
    return `${proto}//${hostPart}:${port}/ws${token ? `?token=${encodeURIComponent(token)}` : ''}`;
  }, []);

  // 各 InstanceView 的状态上报回调（按 instanceId 分组写入 map）
  const makeStatusCallback = useCallback(
    (instanceId: string) => (st: InstanceStatus) => {
      setStatusMap((prev) => {
        const old = prev[instanceId];
        if (old?.connection === st.connection && old?.session === st.session) return prev;
        return { ...prev, [instanceId]: st };
      });
    },
    [],
  );

  // active 实例的 reconnect 注册回调
  const makeRegisterReconnect = useCallback(
    (instanceId: string) => (fn: () => void) => {
      if (instanceId === activeId) setReconnectFn(() => fn);
    },
    [activeId],
  );

  const activeStatus = activeId ? statusMap[activeId] : undefined;
  const connection = activeStatus?.connection ?? 'connecting';
  const session = activeStatus?.session ?? 'idle';

  // 给 InstanceTabs / MobileInstanceSwitcher 同时支持 active 切换 + 兼容旧的 location.assign
  // 我们注入 onSwitch，让组件用本地切换；不传 instances 列表则保留原行为
  const tabsInstances = useMemo(
    () => instances.map((i) => ({ ...i, isCurrent: i.instanceId === activeId })),
    [instances, activeId],
  );

  return (
    <div id="multi-console" className={s.root}>
      <header id="console-header" className={s.header}>
        <div className={s.headerLeft}>
          {isMobile ? (
            <MobileInstanceSwitcher
              instances={tabsInstances}
              onCreateClick={() => setCreateOpen(true)}
              onSwitch={handleSwitch}
              onClose={removeInstance}
            />
          ) : (
            <InstanceTabs
              instances={tabsInstances}
              pending={pending}
              onCreateClick={() => setCreateOpen(true)}
              onSwitch={handleSwitch}
              onClose={removeInstance}
            />
          )}
        </div>
        <StatusBar
          connection={connection}
          session={session}
          onReconnect={reconnectFn ?? undefined}
        />
        <IconButton
          onClick={() => setSearchOpen((v) => !v)}
          aria-label={t('search.aria')}
          aria-pressed={searchOpen}
          title={t('search.aria')}
          variant={searchOpen ? 'accent' : undefined}
        >
          <IconSearch size={14} stroke={1.5} />
        </IconButton>
        <IconButton
          onClick={() => setShareOpen(true)}
          aria-label={t('topBar.share')}
          title={t('topBar.shareTooltip')}
        >
          <IconShare2 size={14} stroke={1.5} />
        </IconButton>
        <IconButton
          onClick={() => setSettingsOpen(true)}
          aria-label={t('topBar.settings')}
          title={t('topBar.settingsTooltip')}
        >
          <IconSettings size={14} stroke={1.5} />
        </IconButton>
      </header>

      {/* 所有实例同时挂载，CSS 切显示 */}
      {instances.map((i) => (
        <InstanceView
          key={i.instanceId}
          instanceId={i.instanceId}
          wsUrl={buildWsUrl(i.host, i.port)}
          config={config}
          active={i.instanceId === activeId}
          onStatusChange={makeStatusCallback(i.instanceId)}
          registerReconnect={makeRegisterReconnect(i.instanceId)}
          searchOpen={searchOpen && i.instanceId === activeId}
          onSearchClose={() => setSearchOpen(false)}
        />
      ))}

      <SettingsModal
        open={settingsOpen}
        current={config}
        onSave={save}
        onClose={() => setSettingsOpen(false)}
      />
      <CreateInstanceModal
        open={createOpen}
        onSubmit={createInstance}
        onClose={() => setCreateOpen(false)}
      />
      <ShareSheet open={shareOpen} onOpenChange={setShareOpen} />
    </div>
  );
}
