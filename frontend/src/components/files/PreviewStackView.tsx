/**
 * PreviewStackView — 文件预览栈视图(纵向列表)
 *
 * 入口:FilePreviewSheet 头栏的 IconStack2 按钮(仅 group:'file-preview' 深度
 * ≥ 2 时显示)。push 一个全屏 sheet,卡片纵向排列,每行代表一个 file-preview。
 *
 * 行为:
 *  - 点卡 → modal-stack.bringToTop(id) → 该层提到栈顶(不动 DOM,保留滚动)
 *    紧接着 onOpenChange(false) 关闭本视图自身
 *  - 卡片右侧 IconX → modal-stack.pop(id) 关该层(不关本视图)
 *  - 向右拖卡(deltaX > 80px) → 同 X 按钮行为,Gmail / iOS swipe-to-dismiss 手势。
 *    纵向布局下"向上拖"会跟列表滚动冲突,改横向 swipe 更直觉
 *  - 卡片显示文件 basename + 完整路径(用 meta.name / meta.path)
 *  - 当前 isTop 那张卡有高亮边
 */

import {
  useEffect,
  useRef,
  useState,
  type JSX,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { IconX } from '@tabler/icons-react';
import { Sheet } from '../ui/Sheet.js';
import { useT } from '../../i18n/i18n-context.js';
import {
  useModalStack,
  useModalStackGroup,
} from '../ui/modal-stack/ModalStack.js';
import s from './PreviewStackView.module.scss';

export interface PreviewStackViewProps {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  /** 仅用于过滤同实例的预览(跨实例共栈场景留出位 — 当前实现忽略,展示全部) */
  instanceId?: string;
}

/** 横向 swipe 关闭单层的阈值(px) */
const DRAG_DISMISS_THRESHOLD = 80;

export function PreviewStackView({
  open,
  onOpenChange,
}: PreviewStackViewProps): JSX.Element {
  const t = useT();
  const stack = useModalStack();
  const items = useModalStackGroup('file-preview');

  // 当栈被 wikilink 等"被动"操作清空(<=1 张)→ 自动关闭本视图,避免空状态尴尬
  useEffect(() => {
    if (open && items.length <= 1) {
      onOpenChange(false);
    }
  }, [open, items.length, onOpenChange]);

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={t('files.previewStackView')}
      className={s.sheet}
      id="file-preview-stack-view"
      hideDragHandle
      hideBackdrop
    >
      <div className={s.root}>
        <div
          className={s.scroller}
          role="list"
          aria-label={t('files.previewStackView')}
        >
          {items.map((item) => (
            <StackCard
              key={item.id}
              id={item.id}
              path={(item.meta?.['path'] as string | undefined) ?? ''}
              name={(item.meta?.['name'] as string | undefined) ?? ''}
              isTop={item.isTop}
              onPick={() => {
                stack.bringToTop(item.id);
                onOpenChange(false);
              }}
              onClose={() => stack.pop(item.id)}
            />
          ))}
        </div>
      </div>
    </Sheet>
  );
}

interface StackCardProps {
  id: string;
  path: string;
  name: string;
  isTop: boolean;
  onPick: () => void;
  onClose: () => void;
}

function StackCard({
  path,
  name,
  isTop,
  onPick,
  onClose,
}: StackCardProps): JSX.Element {
  // 横向 swipe 手势:记录指针 down 时的 x,move 时算 deltaX,松开按阈值决定关 or 复位
  // 纵向列表场景下用左右 swipe 关比向上拖更直觉(且不和列表上下滚动冲突)
  const [dragX, setDragX] = useState(0);
  const downXRef = useRef<number | null>(null);
  const downYRef = useRef<number | null>(null);
  // 锁定手势方向:确定为横向时才接管,纵向时让列表正常滚动
  const lockedAxisRef = useRef<'h' | 'v' | null>(null);
  const pointerIdRef = useRef<number | null>(null);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    downXRef.current = e.clientX;
    downYRef.current = e.clientY;
    lockedAxisRef.current = null;
    pointerIdRef.current = e.pointerId;
    // 暂不 setPointerCapture — 等确认横向手势后再 capture,否则纵向滚动被拦截
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (downXRef.current == null || downYRef.current == null) return;
    const dx = e.clientX - downXRef.current;
    const dy = e.clientY - downYRef.current;
    // 首次超过 6px 时锁轴方向
    if (lockedAxisRef.current == null) {
      if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
      lockedAxisRef.current = Math.abs(dx) > Math.abs(dy) ? 'h' : 'v';
      if (lockedAxisRef.current === 'h' && pointerIdRef.current != null) {
        // 锁定横向 → 接管事件,纵向滚动让浏览器自己处理
        try {
          e.currentTarget.setPointerCapture(pointerIdRef.current);
        } catch {
          // 已经 release 或不可用,忽略
        }
      }
    }
    if (lockedAxisRef.current === 'h') {
      setDragX(dx);
    }
  };

  const onPointerEnd = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const id = pointerIdRef.current;
    if (id != null && e.currentTarget.hasPointerCapture(id)) {
      e.currentTarget.releasePointerCapture(id);
    }
    pointerIdRef.current = null;
    downXRef.current = null;
    downYRef.current = null;
    const axis = lockedAxisRef.current;
    lockedAxisRef.current = null;
    if (axis === 'h' && Math.abs(dragX) > DRAG_DISMISS_THRESHOLD) {
      // 触发关 — 不复位 dragX,卡片直接消失(被 useModalStackGroup 重渲染剔除)
      onClose();
    } else {
      setDragX(0);
    }
  };

  // 点击触发 onPick,但仅在没产生显著拖动时(避免拖完手抬起又被识别为 click)
  const onClick = (): void => {
    if (Math.abs(dragX) < 4) onPick();
  };

  // basename:meta.name 可能是搜索结果传入的 `path:line`(见 FileBrowser.onPickHit),
  // 用 path 自己取 basename 更稳。
  const baseName = (() => {
    const i = path.lastIndexOf('/');
    return i < 0 ? path : path.slice(i + 1);
  })();

  return (
    <div
      className={`${s.card} ${isTop ? s.cardTop : ''}`}
      role="listitem"
      data-action="files-preview-stack-card"
      data-path={path}
      style={{
        transform: dragX !== 0 ? `translateX(${dragX}px)` : undefined,
        opacity: dragX !== 0 ? Math.max(0.3, 1 - Math.abs(dragX) / 200) : undefined,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onClick={onClick}
    >
      <button
        type="button"
        className={s.cardClose}
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        title="close"
        aria-label="close"
      >
        <IconX size={14} stroke={1.8} />
      </button>
      <div className={s.cardBody}>
        <div className={s.cardName}>{baseName || name || '(unnamed)'}</div>
        <div className={s.cardPath}>{path}</div>
      </div>
    </div>
  );
}
