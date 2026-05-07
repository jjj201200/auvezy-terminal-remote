/**
 * InstanceDetailModal
 *
 * 移动端实例详情面板：点击 MobileInstanceSwitcher 卡片后弹出。
 * 完整展示 name / cwd（可点击复制） / host / port，并提供四个动作：
 *   - 切换到此实例
 *   - 断开本设备 WS（不杀 backend）
 *   - 关闭实例（破坏性，触发外部二次确认 modal）
 *   - 取消
 *
 * 设计原则：本组件只负责展示和动作转发；二次确认、实际切换/删除逻辑都由
 * 父组件保留——避免和现有 closeDialog 状态机重复实现。
 */

import { useEffect, useRef, useState, type JSX } from 'react';
import { IconCopy } from '@tabler/icons-react';
import type { InstanceListItem } from 'auvezy-terminal-remote-shared';
import { Sheet } from '../ui/Sheet.js';
import { useT } from '../../i18n/i18n-context.js';
import {
  copyToClipboard,
  detectCopyCapability,
  selectElementText,
  type CopyCapability,
} from '../../utils/clipboard.js';
import s from './InstanceDetailModal.module.scss';

/**
 * 单个字段：label + 框样式 value
 *
 * 三种交互模式（由 capability 决定）：
 *  - 'clipboard' / 'execCommand'：框是 button，点击 = 复制；toast 显示"已复制" / "失败"
 *  - 'selectOnly' (iOS LAN HTTP)：框是 button，点击 = 选中文本；toast 显示"已选中，长按拷贝"
 *
 * 通过 valueRef 暴露真实展示值的 DOM 节点，让父组件 selectElementText 取它做 Range
 */
function Field(props: {
  label: string;
  value: string;
  onActivate: (textEl: HTMLSpanElement | null) => void;
  status: 'ok' | 'fail' | 'selected' | undefined;
  copiedText: string;
  failedText: string;
  selectedText: string;
  wrap?: boolean;
  capability: CopyCapability;
}): JSX.Element {
  const { label, value, onActivate, status, copiedText, failedText, selectedText, wrap, capability } = props;
  const valueRef = useRef<HTMLSpanElement | null>(null);

  const boxClass = [
    s.valueBox,
    wrap && s.valueBoxWrap,
    capability === 'selectOnly' && s.valueBoxSelectMode,
    status === 'ok' && s.valueBoxCopied,
    status === 'fail' && s.valueBoxFailed,
    status === 'selected' && s.valueBoxSelected,
  ].filter(Boolean).join(' ');

  return (
    <div className={s.field}>
      <div className={s.label}>{label}</div>
      <button
        type="button"
        onClick={() => onActivate(valueRef.current)}
        className={boxClass}
        aria-label={`${label}: ${value}`}
      >
        <span ref={valueRef} className={s.valueText}>{value}</span>
        {status === 'ok' && <span className={s.copiedToast}>{copiedText}</span>}
        {status === 'fail' && <span className={`${s.copiedToast} ${s.copiedToastFail}`}>{failedText}</span>}
        {status === 'selected' && <span className={`${s.copiedToast} ${s.copiedToastSelected}`}>{selectedText}</span>}
      </button>
    </div>
  );
}

export interface InstanceDetailModalProps {
  open: boolean;
  instance: InstanceListItem | null;
  /** 该实例是否当前 active（决定"切换"按钮是否可用） */
  isActive: boolean;
  onClose: () => void;
  onSwitch: () => void;
  onDisconnect: () => void;
  /** 触发关闭实例：实际删除前父组件会再弹一个 ConfirmModal */
  onCloseInstance: () => void;
}

export function InstanceDetailModal({
  open,
  instance,
  isActive,
  onClose,
  onSwitch,
  onDisconnect,
  onCloseInstance,
}: InstanceDetailModalProps): JSX.Element | null {
  const t = useT();
  // 用字段名 + 状态记录"哪个字段刚复制成功/失败/已选中"，让对应字段右上角浮 toast。
  // 同时只允许一个字段处于反馈态，避免连续点多次时多个 toast 重叠
  const [copyState, setCopyState] = useState<
    { field: string; status: 'ok' | 'fail' | 'selected' } | null
  >(null);
  const copyTimerRef = useRef<number | null>(null);
  // 启动时探测一次：决定 click 行为（直接复制 / execCommand fallback / 仅选中）
  const [capability] = useState<CopyCapability>(() => detectCopyCapability());

  // 关闭过程中 instance 会被父组件清成 null，但 Sheet 的退出动画还在播。
  // 这段时间继续渲染上一次的 instance 数据，避免 modal 内容瞬间空掉。
  const lastInstanceRef = useRef<InstanceListItem | null>(instance);
  useEffect(() => {
    if (instance) lastInstanceRef.current = instance;
  }, [instance]);
  const display = instance ?? lastInstanceRef.current;

  useEffect(() => () => {
    // 卸载时清理 timer，防止内存泄漏 + setState on unmounted warning
    if (copyTimerRef.current) window.clearTimeout(copyTimerRef.current);
  }, []);

  if (!display) return null;

  /** 通用反馈帮手：设状态 + 自动清除 */
  const flashState = (field: string, status: 'ok' | 'fail' | 'selected', durationMs: number): void => {
    setCopyState({ field, status });
    if (copyTimerRef.current) window.clearTimeout(copyTimerRef.current);
    copyTimerRef.current = window.setTimeout(() => setCopyState(null), durationMs);
  };

  /** clipboard / execCommand 路径：尝试真复制 → 浮"已复制"或"失败" */
  const copyValue = async (fieldKey: string, text: string): Promise<void> => {
    const ok = await copyToClipboard(text);
    flashState(fieldKey, ok ? 'ok' : 'fail', ok ? 1200 : 2200);
  };

  /** select-only 路径（iOS LAN HTTP）：选中文本 → 浮"已选中"。不假装复制 */
  const selectValue = (fieldKey: string, el: Element | null): void => {
    if (!el) return;
    const ok = selectElementText(el);
    if (ok) flashState(fieldKey, 'selected', 2200);
  };

  return (
    <Sheet
      id="instance-detail-modal"
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={t('instance.detailTitle')}
      // 嵌套：本 modal 叠在外层 mobile-instance-sheet 上，普通 overlay 不够浓
      // 会让下层 sheet 内容透过来视觉混乱，用 strong 加深 + 加大模糊
      overlayTone="strong"
      footer={
        <div className={s.footer}>
          <button type="button" onClick={onClose} className={s.cancelBtn}>
            {t('common.cancel')}
          </button>
          <button type="button" onClick={onDisconnect} className={s.disconnectBtn}>
            {t('instance.disconnect')}
          </button>
          <button
            type="button"
            onClick={onCloseInstance}
            className={s.closeBtn}
          >
            {t('instance.close')}
          </button>
          <button
            type="button"
            onClick={onSwitch}
            disabled={isActive}
            className={s.switchBtn}
          >
            {isActive ? t('instance.detailSwitchAlready') : t('instance.detailSwitch')}
          </button>
        </div>
      }
    >
      <div className={s.body}>
        {/* 整页提示：根据当前能力档位选不同文案
              - clipboard / execCommand：'点击字段值可复制'
              - selectOnly（iOS LAN HTTP）：'点击字段值会自动选中，长按选区可复制' */}
        <div className={s.copyHintRow}>
          <IconCopy size={11} stroke={1.5} />
          <span>
            {capability === 'selectOnly'
              ? t('instance.detailSelectHint')
              : t('instance.detailCopyHint')}
          </span>
        </div>

        {(() => {
          // 根据 capability 决定 onActivate 的语义：直接复制 OR 仅选中
          const activate = (fieldKey: string, text: string) =>
            (textEl: HTMLSpanElement | null): void => {
              if (capability === 'selectOnly') selectValue(fieldKey, textEl);
              else void copyValue(fieldKey, text);
            };

          const commonProps = {
            copiedText: t('instance.detailValueCopied'),
            failedText: t('instance.detailCopyFailed'),
            selectedText: t('instance.detailValueSelected'),
            capability,
          };

          return (
            <>
              <Field
                {...commonProps}
                label={t('instance.detailNameLabel')}
                value={display.name}
                onActivate={activate('name', display.name)}
                status={copyState?.field === 'name' ? copyState.status : undefined}
              />
              <Field
                {...commonProps}
                label={t('instance.detailCwdLabel')}
                value={display.cwd}
                onActivate={activate('cwd', display.cwd)}
                status={copyState?.field === 'cwd' ? copyState.status : undefined}
                wrap
              />
              <div className={s.fieldRow}>
                <Field
                  {...commonProps}
                  label={t('instance.detailHostLabel')}
                  value={display.host}
                  onActivate={activate('host', display.host)}
                  status={copyState?.field === 'host' ? copyState.status : undefined}
                />
                <Field
                  {...commonProps}
                  label={t('instance.detailPortLabel')}
                  value={String(display.port)}
                  onActivate={activate('port', String(display.port))}
                  status={copyState?.field === 'port' ? copyState.status : undefined}
                />
              </div>
            </>
          );
        })()}
      </div>
    </Sheet>
  );
}
