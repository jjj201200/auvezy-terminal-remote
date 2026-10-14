/**
 * RecentFilesMenu
 *
 * 文件浏览器搜索框左侧的「最近文件」icon 按钮 + 下拉面板。面板列出当前
 * 实例最近查看的文件(点击直接开预览,含当时的 jumpLine),底部提供清空。
 *
 * limit<=0(不记录)时整个按钮不渲染——由父级按 UserConfig.recentFilesLimit
 * 传入;面板数据每次打开时从 localStorage 现读(打开预览后重开面板即为新)。
 */

import { useEffect, useRef, useState, type JSX } from 'react';
import { IconHistory } from '@tabler/icons-react';
import { useT } from '../../i18n/i18n-context.js';
import {
  getRecentFiles,
  clearRecentFiles,
  type RecentFileEntry,
  type RecentFileTarget,
} from '../../services/recent-files.js';
import s from './RecentFilesMenu.module.scss';

export interface RecentFilesMenuProps {
  instanceId: string;
  /** 记录上限(0=不记录,负值或 -1 由父级换算;<=0 本组件不渲染) */
  limit: number;
  /** 点击最近文件 → 打开预览(target 含 jumpLine 等) */
  onPick: (target: RecentFileTarget) => void;
}

/** 相对时间简述(刚刚 / N 分钟前 / HH:mm / M-D HH:mm) */
function describeTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return '';
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m`;
  const d = new Date(ts);
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return hm;
  return `${d.getMonth() + 1}-${d.getDate()} ${hm}`;
}

export function RecentFilesMenu({ instanceId, limit, onPick }: RecentFilesMenuProps): JSX.Element | null {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<RecentFileEntry[]>([]);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // 外点关闭(mousedown 在面板外 → 收起)
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent): void => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open]);

  if (!(limit > 0)) return null; // 不记录模式:按钮整体隐藏

  const toggle = (): void => {
    if (!open) setEntries(getRecentFiles(instanceId));
    setOpen(!open);
  };

  const pick = (target: RecentFileTarget): void => {
    setOpen(false);
    onPick(target);
  };

  const clear = (): void => {
    clearRecentFiles(instanceId);
    setEntries([]);
  };

  return (
    <div className={s.root} ref={rootRef}>
      <button
        type="button"
        className={s.trigger}
        aria-label={t('files.recentButton')}
        title={t('files.recentButton')}
        onClick={toggle}
      >
        <IconHistory size={16} stroke={1.6} />
      </button>
      {open && (
        <div className={s.panel} role="menu">
          <div className={s.panelHead}>{t('files.recentTitle')}</div>
          {entries.length === 0 ? (
            <div className={s.empty}>{t('files.recentEmpty')}</div>
          ) : (
            <>
              <div className={s.list}>
                {entries.map((e) => (
                  <button
                    type="button"
                    key={`${e.target.path}-${e.viewedAt}`}
                    className={s.item}
                    role="menuitem"
                    onClick={() => pick(e.target)}
                    title={e.target.path}
                  >
                    <span className={s.itemName}>{e.target.name}</span>
                    <span className={s.itemMeta}>
                      <span className={s.itemPath}>{e.target.path}</span>
                      {describeTime(e.viewedAt) && (
                        <span className={s.itemTime}>{describeTime(e.viewedAt)}</span>
                      )}
                    </span>
                  </button>
                ))}
              </div>
              <button type="button" className={s.clear} onClick={clear}>
                {t('files.recentClear')}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
