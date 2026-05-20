/**
 * Breadcrumb:回 cwd / 上级 / 路径段 / 显示隐藏 toggle
 */

import type { JSX } from 'react';
import { useT } from '../../i18n/i18n-context.js';
import s from './FileBrowserSheet.module.scss';

export interface BreadcrumbProps {
  cwd: string;
  path: string;
  parent: string | null;
  onJump: (path: string) => void;
  showHidden: boolean;
  onToggleHidden: () => void;
}

export function Breadcrumb(props: BreadcrumbProps): JSX.Element {
  const t = useT();
  return (
    <div className={s.breadcrumb}>
      <button type="button" onClick={() => props.onJump(props.cwd)}>
        {t('files.toolbarCwd')}
      </button>
      <button
        type="button"
        onClick={() => props.parent && props.onJump(props.parent)}
        disabled={!props.parent}
      >
        ↑ {t('files.toolbarUp')}
      </button>
      <span className={s.segs} title={props.path}>{props.path}</span>
      <label className={s.toggle}>
        <input
          type="checkbox"
          checked={props.showHidden}
          onChange={props.onToggleHidden}
        />
        {t('files.toolbarShowHidden')}
      </label>
    </div>
  );
}
