/**
 * Breadcrumb:回 cwd / 上级 / 路径段分段可点 / 显示隐藏 toggle。
 *
 * 路径段:
 *  - 把 cwd 前缀拆出来,其余分段渲染,各段可点击直接跳那一级
 *  - 横向溢出时滚动条出现,不撑挤左侧两个按钮
 */

import { useMemo, type JSX } from 'react';
import { IconArrowUp, IconHome } from '@tabler/icons-react';
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

interface Segment {
  /** 显示文本 */
  label: string;
  /** 跳转目标绝对路径;null = 当前段(不跳) */
  jumpTo: string | null;
  /** 是否是当前 path */
  current: boolean;
}

export function Breadcrumb(props: BreadcrumbProps): JSX.Element {
  const t = useT();
  const segments = useMemo(
    () => splitPath(props.cwd, props.path),
    [props.cwd, props.path],
  );

  return (
    <div id="file-browser-breadcrumb" className={`${s.breadcrumb} fb-breadcrumb`}>
      <button
        type="button"
        className={`${s.crumbBtn} fb-breadcrumb__cwd`}
        data-action="files-cwd"
        onClick={() => props.onJump(props.cwd)}
        title={t('files.toolbarCwd')}
        aria-label={t('files.toolbarCwd')}
      >
        <IconHome size={14} stroke={1.5} />
      </button>
      <button
        type="button"
        className={`${s.crumbBtn} fb-breadcrumb__up`}
        data-action="files-up"
        onClick={() => props.parent && props.onJump(props.parent)}
        disabled={!props.parent}
        title={t('files.toolbarUp')}
        aria-label={t('files.toolbarUp')}
      >
        <IconArrowUp size={14} stroke={1.5} />
      </button>
      <div
        className={`${s.segs} fb-breadcrumb__segs`}
        title={props.path}
        data-path={props.path}
      >
        {segments.map((seg, i) => (
          <span key={i} className="fb-breadcrumb__seg-wrap">
            {i > 0 && <span className={`${s.sepSlash} fb-breadcrumb__sep`}>/</span>}
            {seg.jumpTo === null || seg.current ? (
              <span
                className={`${s.seg} ${seg.current ? s.segCurrent : ''} fb-breadcrumb__seg ${seg.current ? 'fb-breadcrumb__seg--current' : ''}`}
                data-current={seg.current ? 'true' : 'false'}
              >
                {seg.label}
              </span>
            ) : (
              <button
                type="button"
                className={`${s.seg} fb-breadcrumb__seg fb-breadcrumb__seg--clickable`}
                data-action="files-jump-seg"
                data-jump-to={seg.jumpTo}
                onClick={() => seg.jumpTo && props.onJump(seg.jumpTo)}
              >
                {seg.label}
              </button>
            )}
          </span>
        ))}
      </div>
      <label className={`${s.toggle} fb-breadcrumb__toggle`}>
        <input
          type="checkbox"
          checked={props.showHidden}
          onChange={props.onToggleHidden}
          data-action="files-toggle-hidden"
        />
        {t('files.toolbarShowHidden')}
      </label>
    </div>
  );
}

/**
 * 把 path 拆为可点击段:
 *  - 第 1 段固定 = cwd basename(即"工作目录"代号)
 *  - 后续段 = path 相对 cwd 的子路径段
 *  - 越界(path 不在 cwd 下)时直接拆全 path,所有段都标 jumpTo
 */
function splitPath(cwd: string, path: string): Segment[] {
  const cwdBase = basenameOf(cwd) || '/';
  // path 在 cwd 之内
  if (path === cwd) {
    return [{ label: cwdBase, jumpTo: null, current: true }];
  }
  if (path.startsWith(cwd + '/')) {
    const rest = path.slice(cwd.length + 1);
    const parts = rest.split('/').filter(Boolean);
    const segs: Segment[] = [
      { label: cwdBase, jumpTo: cwd, current: false },
    ];
    let acc = cwd;
    parts.forEach((p, i) => {
      acc = `${acc}/${p}`;
      segs.push({
        label: p,
        jumpTo: acc,
        current: i === parts.length - 1,
      });
    });
    // 标当前段不可点
    if (segs.length > 0) segs[segs.length - 1]!.jumpTo = null;
    return segs;
  }
  // 越界(用户走到 cwd 之上),把绝对路径整段拆
  const parts = path.split('/').filter(Boolean);
  const segs: Segment[] = [];
  let acc = '';
  parts.forEach((p, i) => {
    acc = `${acc}/${p}`;
    segs.push({
      label: p,
      jumpTo: acc,
      current: i === parts.length - 1,
    });
  });
  if (segs.length > 0) segs[segs.length - 1]!.jumpTo = null;
  return segs;
}

function basenameOf(p: string): string {
  const trimmed = p.replace(/\/+$/, '');
  const idx = trimmed.lastIndexOf('/');
  return idx >= 0 ? trimmed.slice(idx + 1) : trimmed;
}
