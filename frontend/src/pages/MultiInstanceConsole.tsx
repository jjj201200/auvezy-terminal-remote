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

import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import { IconArrowAutofitWidth, IconRefresh, IconSearch, IconSettings, IconShare2 } from '@tabler/icons-react';
import type { InstanceListItem, SessionStatus } from 'auvezy-terminal-remote-shared';
import { useUserConfig } from '../hooks/useUserConfig.js';
import { useInstances } from '../hooks/useInstances.js';
import { useMediaQuery } from '../hooks/useMediaQuery.js';
import { useDisconnected } from '../hooks/useDisconnected.js';
import { pruneDisconnected } from '../services/disconnected-instances.js';
import { useT } from '../i18n/i18n-context.js';
import type { ConnectionStatus } from '../stores/app-store.js';
import { StatusBar } from '../components/status/StatusBar.js';
import { InstanceTabs } from '../components/instances/InstanceTabs.js';
import { MobileInstanceSwitcher } from '../components/instances/MobileInstanceSwitcher.js';
import { InstanceView } from '../components/instances/InstanceView.js';
import { IconButton } from '../components/ui/IconButton.js';
import {
  useCreateInstancePresenter,
  useManageHostsPresenter,
  useSettingsPresenter,
  useSharePresenter,
} from '../components/ui/modal-stack/presenters.js';
import { useConfirm } from '../components/ui/ConfirmProvider.js';
import { loadToken } from '../services/token-storage.js';
import { buildInstanceUrl } from '../services/instance-url.js';
import { hardReload } from '../utils/hard-reload.js';
import s from './ConsolePage.module.scss';

interface InstanceStatus {
  connection: ConnectionStatus;
  session: SessionStatus;
}

export function MultiInstanceConsole(): JSX.Element {
  const t = useT();
  const isMobile = useMediaQuery('(max-width: 767px)');
  const { config, save } = useUserConfig();
  const {
    instances,
    pending,
    create: createInstance,
    remove: rawRemoveInstance,
    retryPending,
    dismissPending,
  } = useInstances();
  const { isDisconnected, disconnect, reconnect } = useDisconnected();

  // 实例列表变更后顺手 prune 已经不存在的 disconnected id
  useEffect(() => {
    pruneDisconnected(instances.map((i) => i.instanceId));
  }, [instances]);

  // 关闭实例的包装：成功且没有别的实例了 → 弹出"创建实例"modal，
  // 让用户立刻有路可走（前端 token 已存，新实例创建后能直接用）
  const removeInstance = useCallback(
    async (instanceId: string): Promise<string | null> => {
      const err = await rawRemoveInstance(instanceId);
      if (err === null) {
        const remaining = instances.filter((i) => i.instanceId !== instanceId);
        if (remaining.length === 0) {
          presentCreate({ onSubmit: createInstance });
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
    if (!killId) return;
    params.delete('killAfterSwitch');
    const newSearch = params.toString();
    const newUrl =
      window.location.pathname + (newSearch ? `?${newSearch}` : '') + window.location.hash;
    window.history.replaceState(null, '', newUrl);
    void rawRemoveInstance(killId);
  }, [rawRemoveInstance]);

  // 仅 SearchBar 还需要本地受控（它是嵌入式 UI，不走 modal stack）
  const [searchOpen, setSearchOpen] = useState(false);

  // Modal presenter 函数（每个调用 push 一个 stack entry）
  const presentSettings = useSettingsPresenter();
  const presentShare = useSharePresenter();
  const presentCreate = useCreateInstancePresenter();
  const presentManageHosts = useManageHostsPresenter();
  const confirm = useConfirm();

  // 当前 active 实例 id；首次默认 = 当前服务进程标记 isCurrent 的那个
  const [activeId, setActiveId] = useState<string | null>(null);

  // 各实例状态映射：activeId 对应的状态会显示在顶栏 StatusBar
  const [statusMap, setStatusMap] = useState<Record<string, InstanceStatus>>({});

  // active 实例的 reconnect 回调（StatusBar 点击重连用）
  const [reconnectFn, setReconnectFn] = useState<(() => void) | null>(null);
  // active 实例的 adaptToDevice 回调（顶栏"按当前设备适配"按钮用）
  const [adaptFn, setAdaptFn] = useState<(() => void) | null>(null);

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

  // ───── modal triggers（用 ModalStack push） ─────
  const openCreate = useCallback(() => {
    presentCreate({ onSubmit: createInstance });
  }, [presentCreate, createInstance]);

  const openSettings = useCallback(() => {
    presentSettings({ current: config, onSave: save });
  }, [presentSettings, config, save]);

  const openShare = useCallback(() => {
    presentShare({});
  }, [presentShare]);

  // tab 关闭按钮 → 走 useConfirm 的 Promise 流程
  // 三种形态合并到一条线性代码：lastBlocked = singleButton；其它两种是
  // 三按钮（取消 / 断开 / 关闭）；confirmCurrent 在确认后 location.assign 跳到 target
  const handleCloseRequest = useCallback(
    async (i: InstanceListItem): Promise<void> => {
      if (i.isCurrent) {
        const others = instances.filter((x) => x.instanceId !== i.instanceId);
        if (others.length === 0) {
          await confirm({
            title: t('instance.closeCurrentLastTitle'),
            message: t('instance.closeCurrentLast'),
            singleButton: true,
          });
          return;
        }
        const target = others[0]!;
        const result = await confirm({
          title: t('instance.closeCurrentConfirmTitle'),
          messageTemplate: t('instance.closeCurrentConfirm'),
          messageVars: { name: i.name },
          highlightVar: 'name',
          tone: 'danger',
          confirmLabel: t('instance.close'),
          extraLabel: t('instance.disconnect'),
        });
        if (result === true) {
          // 跳转到 target 实例，URL 带 killAfterSwitch 让新前端 mount 后 DELETE 老进程
          const url = new URL(buildInstanceUrl(target.host, target.port), window.location.href);
          url.searchParams.set('killAfterSwitch', i.instanceId);
          window.location.assign(url.toString());
        } else if (result === 'extra') {
          disconnect(i.instanceId);
        }
        return;
      }
      const result = await confirm({
        title: t('instance.closeOrDisconnectTitle'),
        messageTemplate: t('instance.closeOrDisconnectBody'),
        messageVars: { name: i.name },
        highlightVar: 'name',
        tone: 'danger',
        confirmLabel: t('instance.close'),
        extraLabel: t('instance.disconnect'),
      });
      if (result === true) {
        const err = await removeInstance(i.instanceId);
        if (err !== null) {
          await confirm({
            title: t('instance.closeFailedTitle'),
            message: err,
            singleButton: true,
          });
        }
      } else if (result === 'extra') {
        disconnect(i.instanceId);
      }
    },
    [instances, confirm, t, removeInstance, disconnect],
  );

  // 给每个实例算 wsUrl
  // 关键：用"端口相同 = 同 backend = 同源"判断，而不是 hostname === host。
  // 一台机器可能同时挂 LAN/Tailscale/虚拟网卡多个 IP，backend 写进 registry 的 host
  // 只是其中一个；用户从任意 IP 访问页面都应走同源 cookie。跨 port（多实例）才用
  // 当前页面 hostname 拼跨实例 URL（用户能 reach 当前 host，姊妹实例也大概率 bind
  // 在 0.0.0.0，从同一 host 能连上）。
  const buildWsUrl = useCallback((_host: string, port: number): string | undefined => {
    const currentPort = String(
      window.location.port || (window.location.protocol === 'https:' ? 443 : 80),
    );
    if (currentPort === String(port)) return undefined; // 同 port → 同源默认
    const token = loadToken();
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const currentHost = window.location.hostname;
    const hostPart =
      currentHost.includes(':') && !currentHost.startsWith('[') ? `[${currentHost}]` : currentHost;
    return `${proto}//${hostPart}:${port}/ws${token ? `?token=${encodeURIComponent(token)}` : ''}`;
  }, []);

  // 给 InstanceView 的回调：必须用稳定引用（每次新建会触发其内部 effect 链 →
  // setState → 父重 render → 又新建 → 死循环）。
  // 方案：单一稳定的回调签名 (instanceId, ...) ，InstanceView 那边把 instanceId
  // 透传回来——这样 useCallback 真正稳定（依赖空数组就 OK）
  const onInstanceStatusChange = useCallback(
    (instanceId: string, st: InstanceStatus) => {
      setStatusMap((prev) => {
        const old = prev[instanceId];
        if (old?.connection === st.connection && old?.session === st.session) return prev;
        return { ...prev, [instanceId]: st };
      });
    },
    [],
  );

  // 同上：稳定签名。内部用 activeId / reconnect 的 ref 镜像，避免依赖变化
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;
  const reconnectRef = useRef(reconnect);
  reconnectRef.current = reconnect;
  const onInstanceRegisterReconnect = useCallback(
    (instanceId: string, fn: () => void) => {
      if (instanceId !== activeIdRef.current) return;
      setReconnectFn(() => () => {
        reconnectRef.current(instanceId);
        fn();
      });
    },
    [],
  );

  // active 实例注册它的 adaptToDevice 回调；切实例时旧回调被新值覆盖
  const onInstanceRegisterAdapt = useCallback(
    (instanceId: string, fn: () => void) => {
      if (instanceId !== activeIdRef.current) return;
      setAdaptFn(() => fn);
    },
    [],
  );

  // 覆盖层"重连"按钮：稳定回调，内部读 ref 拿最新 reconnect
  const onInstanceReconnect = useCallback((instanceId: string) => {
    reconnectRef.current(instanceId);
  }, []);

  // SearchBar 关闭：稳定 setter（setSearchOpen 本身就稳，包一层只是定 false）
  const onSearchClose = useCallback(() => setSearchOpen(false), []);

  const activeStatus = activeId ? statusMap[activeId] : undefined;
  const connection = activeStatus?.connection ?? 'connecting';
  const session = activeStatus?.session ?? 'idle';

  // 注意：保留 backend 真实 isCurrent（决定"该实例是否是 serve webapp 的进程"，
  // 用于关闭按钮的"必须先跳转"判断），高亮态用单独的 activeId prop 传给 InstanceTabs
  const tabsInstances = instances;

  const openManageHosts = useCallback(() => {
    presentManageHosts({
      instances: tabsInstances,
      activeId,
      pending,
      onCreateClick: openCreate,
      onSwitch: handleSwitch,
      onCloseRequest: (i) => void handleCloseRequest(i),
      onDisconnectRequest: (i) => disconnect(i.instanceId),
      onPendingRetry: retryPending,
      onPendingDismiss: dismissPending,
    });
  }, [
    presentManageHosts,
    tabsInstances,
    activeId,
    pending,
    openCreate,
    handleSwitch,
    handleCloseRequest,
    disconnect,
    retryPending,
    dismissPending,
  ]);

  return (
    <div id="multi-console" className={s.root}>
      <header id="console-header" className={s.header}>
        <div className={s.headerLeft}>
          {isMobile ? (
            // 移动端：只渲染 trigger 按钮，点击通过 stack 推 sheet
            // 用 hideTrigger=false / externalOpen=undefined 让组件自己管 trigger 显示
            // 但点 trigger 时调外层 openManageHosts 而非内部 setOpen
            <MobileInstanceSwitcher
              instances={tabsInstances}
              activeId={activeId}
              pending={pending}
              onCreateClick={openCreate}
              onSwitch={handleSwitch}
              onCloseRequest={(i) => void handleCloseRequest(i)}
              onDisconnectRequest={(i) => disconnect(i.instanceId)}
              onPendingRetry={retryPending}
              onPendingDismiss={dismissPending}
              externalOpen={false}
              onExternalOpenChange={(next) => {
                if (next) openManageHosts();
              }}
            />
          ) : (
            <InstanceTabs
              instances={tabsInstances}
              activeId={activeId}
              pending={pending}
              onCreateClick={openCreate}
              onSwitch={handleSwitch}
              onCloseRequest={(i) => void handleCloseRequest(i)}
              onDisconnectRequest={(i) => disconnect(i.instanceId)}
              onPendingRetry={retryPending}
              onPendingDismiss={dismissPending}
              manageOpen={false}
              onManageOpenChange={(next) => {
                if (next) openManageHosts();
              }}
            />
          )}
        </div>
        <StatusBar
          connection={connection}
          session={session}
          onReconnect={reconnectFn ?? undefined}
        />
        <IconButton
          onClick={() => {
            void hardReload();
          }}
          aria-label={t('topBar.hardReload')}
          title={t('topBar.hardReloadTooltip')}
        >
          <IconRefresh size={14} stroke={1.5} />
        </IconButton>
        {adaptFn && (
          <IconButton
            onClick={() => adaptFn()}
            aria-label={t('input.adaptSize')}
            title={t('input.adaptSizeTooltip')}
          >
            <IconArrowAutofitWidth size={14} stroke={1.5} />
          </IconButton>
        )}
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
          onClick={openShare}
          aria-label={t('topBar.share')}
          title={t('topBar.shareTooltip')}
        >
          <IconShare2 size={14} stroke={1.5} />
        </IconButton>
        <IconButton
          onClick={openSettings}
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
          onStatusChange={onInstanceStatusChange}
          registerReconnect={onInstanceRegisterReconnect}
          registerAdapt={onInstanceRegisterAdapt}
          searchOpen={searchOpen && i.instanceId === activeId}
          onSearchClose={onSearchClose}
          disabled={isDisconnected(i.instanceId)}
          onReconnect={onInstanceReconnect}
        />
      ))}

      {/*
        所有 modal（Settings / Create / Share / 主机管理 / 关闭实例确认）
        统一由 ModalStack 管理，调用方走 presenter 函数 / useConfirm。
        这里不再有 modal jsx。
      */}
    </div>
  );
}
