/**
 * SettingsModal
 *
 * 设置面板：桌面 modal / 移动 sheet（共用 Sheet primitive）。
 * tabs：通用 / 操作 / 显示 / 其他 / 关于（通知 tab 暂时隐藏）。
 * "其他"合并原"网络 + 集成 + 开发"三段,各自原组件按 section 顺序拼接,无外壳。
 *
 * 编辑模型：本地草稿 → "保存"按钮统一应用三类 state：
 *  - 后端 UserConfig（PUT /api/config）
 *  - i18n locale（写 localStorage + 切语言）
 *  - 客户端开发者偏好（写 localStorage，刷新生效）
 *
 * 「关于」tab 纯展示，没有 footer。其它 tab 一律有"取消 / 保存"按钮在底部。
 */

import { useEffect, useMemo, useRef, useState, type JSX } from 'react';
import type { UserConfig } from 'auvezy-terminal-remote-shared';
import { Sheet, type SheetTab } from '../ui/Sheet.js';
import { useI18n, useT } from '../../i18n/i18n-context.js';
import type { Locale } from '../../i18n/messages.js';
import { DisplaySettings } from './DisplaySettings.js';
import { NetworkSettings } from './NetworkSettings.js';
import { GeneralSettings } from './GeneralSettings.js';
import { ActionsSettings } from './ActionsSettings.js';
import { IntegrationsSettings } from './IntegrationsSettings.js';
import { DevSettings } from './DevSettings.js';
import { AboutSettings } from './AboutSettings.js';
import { PushToggle } from '../common/PushToggle.js';
import {
  loadClientPrefs,
  saveClientPrefs,
  type ClientPrefs,
} from '../../services/client-prefs.js';
import s from './SettingsModal.module.scss';

export interface SettingsModalProps {
  open: boolean;
  current: UserConfig;
  onSave: (next: UserConfig) => Promise<boolean>;
  onClose: () => void;
}

type TabKey =
  | 'general'
  | 'actions'
  | 'display'
  | 'other'
  | 'about'
  | 'notifications';

export function SettingsModal({
  open,
  current,
  onSave,
  onClose,
}: SettingsModalProps): JSX.Element {
  const t = useT();
  const { locale, setLocale } = useI18n();
  const [tab, setTab] = useState<TabKey>('general');
  // 每个可编辑维度都维护"baseline（当前已应用值）+ draft（编辑中）"
  // 用于 dirty 检测：apply 后 baseline 同步到 draft，apply 按钮变 disabled
  const [draft, setDraft] = useState<UserConfig>(current);
  const [draftBaseline, setDraftBaseline] = useState<UserConfig>(current);
  const [localeDraft, setLocaleDraft] = useState<Locale>(locale);
  const [localeBaseline, setLocaleBaseline] = useState<Locale>(locale);
  const [prefsDraft, setPrefsDraft] = useState<ClientPrefs>(() => loadClientPrefs());
  const [prefsBaseline, setPrefsBaseline] = useState<ClientPrefs>(() => loadClientPrefs());
  const [saving, setSaving] = useState(false);
  const [applying, setApplying] = useState(false);

  // 仅在 open 由 false → true 时重置（不依赖 current —— current 在 apply
  // 后会变新引用，依赖它会导致 tab 跳回 general / draft 被回滚为 baseline）
  const wasOpenRef = useRef(open);
  useEffect(() => {
    if (open && !wasOpenRef.current) {
      setDraft(current);
      setDraftBaseline(current);
      setLocaleDraft(locale);
      setLocaleBaseline(locale);
      const p = loadClientPrefs();
      setPrefsDraft(p);
      setPrefsBaseline(p);
      setTab('general');
    }
    wasOpenRef.current = open;
    // 故意不依赖 locale / current —— 打开瞬间快照即可，期间外部值变动不跟
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // dirty 检测：值比对（不是引用比对！）
  // - UserConfig 编辑会产生新对象引用；用户把值改回原状后引用仍 ≠ baseline
  //   → 必须按值比。结构稳定 + 体积小，JSON.stringify 是最简单可靠的方式
  // - locale / clientPrefs 是基本类型，直接比
  const dirty = useMemo(() => {
    if (JSON.stringify(draft) !== JSON.stringify(draftBaseline)) return true;
    if (localeDraft !== localeBaseline) return true;
    if (
      prefsDraft.eruda !== prefsBaseline.eruda ||
      prefsDraft.consoleBridge !== prefsBaseline.consoleBridge
    ) {
      return true;
    }
    return false;
  }, [draft, draftBaseline, localeDraft, localeBaseline, prefsDraft, prefsBaseline]);

  /**
   * 把当前三类草稿落盘 / 应用：
   *  - locale 改了 → setLocale 写 localStorage + 切 i18n
   *  - clientPrefs 改了 → 写 localStorage（刷新生效）
   *  - UserConfig 改了 → PUT /api/config（异步，可能失败）
   * 返回 backend 是否成功（true / 没改动也算 true）
   */
  const applyDrafts = async (): Promise<boolean> => {
    if (localeDraft !== localeBaseline) setLocale(localeDraft);
    if (
      prefsDraft.eruda !== prefsBaseline.eruda ||
      prefsDraft.consoleBridge !== prefsBaseline.consoleBridge
    ) {
      saveClientPrefs(prefsDraft);
    }
    // 同 dirty 用值比对：避免"编辑后又改回原值"白白触发 PUT
    if (JSON.stringify(draft) !== JSON.stringify(draftBaseline)) {
      const ok = await onSave(draft);
      if (!ok) return false;
    }
    return true;
  };

  /**
   * 把"中间态"的展示门槛抬到 200ms：耗时短于这个阈值时不显示 "应用中…" /
   * "保存中…"，避免 LAN PUT 100-300ms 导致按钮文案闪一下。
   *
   * 实现：延迟 200ms 才 setBusy(true)；请求完成时清掉 timer + 立即 setBusy(false)。
   */
  const BUSY_THRESHOLD_MS = 200;
  const runWithDeferredBusy = async (
    setBusy: (next: boolean) => void,
    fn: () => Promise<boolean>,
  ): Promise<boolean> => {
    const timer = setTimeout(() => setBusy(true), BUSY_THRESHOLD_MS);
    try {
      return await fn();
    } finally {
      clearTimeout(timer);
      setBusy(false);
    }
  };

  const handleApply = async (): Promise<void> => {
    const ok = await runWithDeferredBusy(setApplying, applyDrafts);
    if (ok) {
      // baseline 同步：dirty 立即变 false，apply 按钮 disable
      setDraftBaseline(draft);
      setLocaleBaseline(localeDraft);
      setPrefsBaseline(prefsDraft);
    } else {
      alert(t('settings.saveError'));
    }
  };

  const handleSave = async (): Promise<void> => {
    const ok = await runWithDeferredBusy(setSaving, applyDrafts);
    if (ok) onClose();
    else alert(t('settings.saveError'));
  };

  // tabs 顺序:通用 → 操作 → 显示 → 其他(网络 + 集成 + 开发合并)→ 关于
  const tabs: SheetTab[] = useMemo(
    () => [
      { id: 'general', title: t('settings.tab.general') },
      { id: 'actions', title: t('settings.tab.actions') },
      { id: 'display', title: t('settings.tab.display') },
      { id: 'other', title: t('settings.tab.other') },
      { id: 'about', title: t('settings.tab.about') },
    ],
    [t],
  );

  return (
    <Sheet
      id="settings-modal"
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={t('settings.title')}
      tabs={tabs}
      activeTab={tab}
      onTabChange={(id) => setTab(id as TabKey)}
      footer={
        // 「关于」纯展示无 footer；「通知」如未来重新暴露由 PushToggle 自行处理
        tab !== 'about' && tab !== 'notifications' ? (
          <>
            <button type="button" onClick={onClose} className={s.cancelBtn}>
              {t('common.cancel')}
            </button>
            <button
              type="button"
              disabled={!dirty || applying || saving}
              onClick={() => void handleApply()}
              className={s.applyBtn}
            >
              {applying ? t('settings.applying') : t('settings.apply')}
            </button>
            <button
              type="button"
              disabled={saving || applying}
              onClick={() => void handleSave()}
              className={s.saveBtn}
            >
              {saving ? t('settings.saving') : t('common.save')}
            </button>
          </>
        ) : undefined
      }
    >
      {tab === 'general' && (
        <GeneralSettings value={localeDraft} onChange={setLocaleDraft} />
      )}
      {tab === 'actions' && <ActionsSettings value={draft} onChange={setDraft} />}
      {tab === 'display' && (
        <DisplaySettings
          value={draft.display}
          onChange={(display) => setDraft({ ...draft, display })}
        />
      )}
      {tab === 'other' && (
        <div className={s.otherStack}>
          <NetworkSettings
            value={draft.network}
            onChange={(network) => setDraft({ ...draft, network })}
          />
          <IntegrationsSettings
            value={draft.integrations}
            onChange={(integrations) => setDraft({ ...draft, integrations })}
          />
          <DevSettings value={prefsDraft} onChange={setPrefsDraft} />
        </div>
      )}
      {tab === 'about' && <AboutSettings />}
      {tab === 'notifications' && <PushToggle />}
    </Sheet>
  );
}
