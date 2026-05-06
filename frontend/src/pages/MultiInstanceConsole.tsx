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
import { IconSearch, IconSettings, IconShare2 } from '@tabler/icons-react';
import type { InstanceListItem, SessionStatus } from '@otr/shared';
import { useUserConfig } from '../hooks/useUserConfig.js';
import { useInstances } from '../hooks/useInstances.js';
import { useMediaQuery } from '../hooks/useMediaQuery.js';
import { useDisconnected } from '../hooks/useDisconnected.js';
import { pruneDisconnected } from '../services/disconnected-instances.js';
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
import { ConfirmModal } from '../components/ui/ConfirmModal.js';
import { loadToken } from '../services/token-storage.js';
import { buildInstanceUrl } from '../services/instance-url.js';
import s from './ConsolePage.module.scss';

/** 关闭实例的确认状态机（互斥的几种 modal 形态） */
type CloseDialog =
  | { kind: 'idle' }
  // 普通关闭确认（非 isCurrent）
  | { kind: 'confirm'; instance: InstanceListItem }
  // 关闭当前 webapp 服务实例的确认（确认后跳到另一个实例 + killAfterSwitch）
  | { kind: 'confirmCurrent'; instance: InstanceListItem; target: InstanceListItem }
  // 唯一实例不可关
  | { kind: 'lastBlocked'; instance: InstanceListItem }
  // 关闭失败结果展示
  | { kind: 'failed'; message: string };

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
    if (!killId) return;
    params.delete('killAfterSwitch');
    const newSearch = params.toString();
    const newUrl =
      window.location.pathname + (newSearch ? `?${newSearch}` : '') + window.location.hash;
    window.history.replaceState(null, '', newUrl);
    void rawRemoveInstance(killId);
  }, [rawRemoveInstance]);

  // 共享 modal 开关
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  // 关闭实例的页内 ConfirmModal 状态机（替代 window.confirm/alert）
  const [closeDialog, setCloseDialog] = useState<CloseDialog>({ kind: 'idle' });

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

  // tab 关闭按钮 → 触发页内 ConfirmModal（区分 isCurrent / 唯一实例 / 普通三路）
  const handleCloseRequest = useCallback((i: InstanceListItem): void => {
    if (i.isCurrent) {
      const others = instances.filter((x) => x.instanceId !== i.instanceId);
      if (others.length === 0) {
        setCloseDialog({ kind: 'lastBlocked', instance: i });
        return;
      }
      // 选一个目标实例（第一个非 self 即可）
      const target = others[0]!;
      setCloseDialog({ kind: 'confirmCurrent', instance: i, target });
      return;
    }
    setCloseDialog({ kind: 'confirm', instance: i });
  }, [instances]);

  // ConfirmModal "确认" = 删除（破坏性）
  const handleConfirmClose = useCallback(async (): Promise<void> => {
    if (closeDialog.kind === 'confirm') {
      const id = closeDialog.instance.instanceId;
      setCloseDialog({ kind: 'idle' });
      const err = await removeInstance(id);
      if (err !== null) setCloseDialog({ kind: 'failed', message: err });
    } else if (closeDialog.kind === 'confirmCurrent') {
      // 跳转到 target 实例，URL 带 killAfterSwitch 让新前端 mount 后 DELETE 老进程
      const { instance, target } = closeDialog;
      const url = new URL(buildInstanceUrl(target.host, target.port), window.location.href);
      url.searchParams.set('killAfterSwitch', instance.instanceId);
      window.location.assign(url.toString());
    } else {
      // lastBlocked / failed：单按钮，确认 = 关闭
      setCloseDialog({ kind: 'idle' });
    }
  }, [closeDialog, removeInstance]);

  // ConfirmModal "断开"（非 isCurrent / isCurrent 都支持）= 仅本设备断开 WS，
  // backend 进程不动，其他设备不受影响
  const handleDisconnectFromDialog = useCallback((): void => {
    if (closeDialog.kind === 'confirm') {
      disconnect(closeDialog.instance.instanceId);
    } else if (closeDialog.kind === 'confirmCurrent') {
      disconnect(closeDialog.instance.instanceId);
    }
    setCloseDialog({ kind: 'idle' });
  }, [closeDialog, disconnect]);

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

  return (
    <div id="multi-console" className={s.root}>
      <header id="console-header" className={s.header}>
        <div className={s.headerLeft}>
          {isMobile ? (
            <MobileInstanceSwitcher
              instances={tabsInstances}
              activeId={activeId}
              pending={pending}
              onCreateClick={() => setCreateOpen(true)}
              onSwitch={handleSwitch}
              onCloseRequest={handleCloseRequest}
              onPendingRetry={retryPending}
              onPendingDismiss={dismissPending}
            />
          ) : (
            <InstanceTabs
              instances={tabsInstances}
              activeId={activeId}
              pending={pending}
              onCreateClick={() => setCreateOpen(true)}
              onSwitch={handleSwitch}
              onCloseRequest={handleCloseRequest}
              onPendingRetry={retryPending}
              onPendingDismiss={dismissPending}
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
          onStatusChange={onInstanceStatusChange}
          registerReconnect={onInstanceRegisterReconnect}
          searchOpen={searchOpen && i.instanceId === activeId}
          onSearchClose={onSearchClose}
          disabled={isDisconnected(i.instanceId)}
          onReconnect={onInstanceReconnect}
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

      {/* 关闭实例的页内 ConfirmModal —— 根据 closeDialog.kind 派生 props，单实例 */}
      {(() => {
        switch (closeDialog.kind) {
          case 'confirm':
            return (
              <ConfirmModal
                open
                title={t('instance.closeOrDisconnectTitle')}
                messageTemplate={t('instance.closeOrDisconnectBody')}
                messageVars={{ name: closeDialog.instance.name }}
                highlightVar="name"
                confirmTone="danger"
                confirmLabel={t('instance.close')}
                extraLabel={t('instance.disconnect')}
                onExtra={handleDisconnectFromDialog}
                onConfirm={handleConfirmClose}
                onClose={() => setCloseDialog({ kind: 'idle' })}
              />
            );
          case 'confirmCurrent':
            return (
              <ConfirmModal
                open
                title={t('instance.closeCurrentConfirmTitle')}
                messageTemplate={t('instance.closeCurrentConfirm')}
                messageVars={{ name: closeDialog.instance.name }}
                highlightVar="name"
                confirmTone="danger"
                confirmLabel={t('instance.close')}
                extraLabel={t('instance.disconnect')}
                onExtra={handleDisconnectFromDialog}
                onConfirm={handleConfirmClose}
                onClose={() => setCloseDialog({ kind: 'idle' })}
              />
            );
          case 'lastBlocked':
            return (
              <ConfirmModal
                open
                title={t('instance.closeCurrentLastTitle')}
                message={t('instance.closeCurrentLast')}
                singleButton
                confirmLabel={t('common.confirm')}
                onConfirm={handleConfirmClose}
                onClose={() => setCloseDialog({ kind: 'idle' })}
              />
            );
          case 'failed':
            return (
              <ConfirmModal
                open
                title={t('instance.closeFailedTitle')}
                message={closeDialog.message}
                singleButton
                confirmLabel={t('common.confirm')}
                onConfirm={handleConfirmClose}
                onClose={() => setCloseDialog({ kind: 'idle' })}
              />
            );
          default:
            return null;
        }
      })()}
    </div>
  );
}
