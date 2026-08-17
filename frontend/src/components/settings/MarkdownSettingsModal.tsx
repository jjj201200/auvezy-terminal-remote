/**
 * MarkdownSettingsModal
 *
 * Markdown 集成详细设置子 modal(正文字号)。形态对齐
 * ObsidianSettingsModal / ClaudeCodeSettingsModal:Sheet 容器 + 顶部 hint +
 * 字号预设行(Auto + 预设 + 自定义,同显示设置"最大列数"的控件形态)。
 * 总开关在集成列表的 section row(与 Obsidian 一致),不在此 modal。
 *
 * 编辑模型:受控 value/onChange,变更直接回写父 SettingsModal 的 draft —— 关闭
 * modal 不丢改动,跨多层 modal 仍是单一 dirty 检测点。
 *
 * modal-stack entry 固化 present() 时的 props(受控值是打开瞬间的快照),
 * 编辑态在 modal 内部持有:mount 快照播种 + 本地累积 + 每次变更上报 onChange。
 */

import { useEffect, useState, type JSX } from 'react';
import clsx from 'clsx';
import {
  MARKDOWN_FONT_SIZE_AUTO,
  MARKDOWN_FONT_SIZE_MAX,
  MARKDOWN_FONT_SIZE_MIN,
  MARKDOWN_FONT_SIZE_PRESETS,
} from 'auvezy-terminal-remote-shared';
import { Sheet } from '../ui/Sheet.js';
import { useT } from '../../i18n/i18n-context.js';
import { getDefaultMarkdownFontSize } from '../../config/constants.js';
import s from './GeneralSettings.module.scss';

export interface MarkdownSettingsModalProps {
  open: boolean;
  onClose: () => void;
  /** 正文字号当前值(px;0 = Auto) */
  fontSize: number;
  /** 字号改动回调,父级 SettingsModal draft 接管落盘 */
  onFontSizeChange: (next: number) => void;
}

export function MarkdownSettingsModal({
  open,
  onClose,
  fontSize,
  onFontSizeChange,
}: MarkdownSettingsModalProps): JSX.Element {
  const t = useT();

  const [localFs, setLocalFs] = useState(fontSize);

  // Auto 模式实际生效的字号(--fs-md,编译期 token 不会变,读一次即可);
  // 按钮上显示 "Auto · 13" 与显示设置最大列数的 Auto 按钮形态一致
  const [autoMdFs] = useState(getDefaultMarkdownFontSize);

  // 自定义字号输入框:与 localFs 双向绑定,允许输入中途为空(空 = Auto)
  const [fsInput, setFsInput] = useState<string>(
    localFs > MARKDOWN_FONT_SIZE_AUTO ? String(localFs) : '',
  );
  useEffect(() => {
    setFsInput(localFs > MARKDOWN_FONT_SIZE_AUTO ? String(localFs) : '');
  }, [localFs]);

  const setFs = (next: number): void => {
    setLocalFs(next);
    onFontSizeChange(next);
  };

  const handleFsInput = (v: string): void => {
    setFsInput(v);
    if (v === '') return;
    const n = Number(v);
    if (!Number.isInteger(n)) return;
    if (n < MARKDOWN_FONT_SIZE_MIN || n > MARKDOWN_FONT_SIZE_MAX) return;
    setFs(n);
  };

  const handleFsBlur = (): void => {
    if (fsInput === '') {
      // 留空 = Auto
      setFs(MARKDOWN_FONT_SIZE_AUTO);
      return;
    }
    const n = Number(fsInput);
    if (!Number.isInteger(n)) {
      setFsInput(localFs > MARKDOWN_FONT_SIZE_AUTO ? String(localFs) : '');
      return;
    }
    setFs(Math.max(MARKDOWN_FONT_SIZE_MIN, Math.min(MARKDOWN_FONT_SIZE_MAX, n)));
  };

  return (
    <Sheet
      id="markdown-settings-modal"
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={t('obsidian.markdownModalTitle')}
    >
      <div className={s.root}>
        <p className={s.hint}>{t('obsidian.markdownModalHint')}</p>

        {/* 正文字号(总开关在集成列表 row,不在此;未激活时仍可调,激活后生效
            —— 与 ClaudeCode 事件订阅同一语义)。
            Why 不学显示设置"最大列数"用列数反推:markdown 是比例字体 + 自动
            折行,列数不是硬契约(终端是),直接用 px 选;Auto = 应用默认字号。 */}
        <section className={s.section}>
          <header className={s.header}>
            <h3 className={s.title}>{t('integrations.mdFontSizeTitle')}</h3>
            <p className={s.hint}>{t('integrations.mdFontSizeHint')}</p>
          </header>
          <div className={s.row}>
            <button
              type="button"
              onClick={() => setFs(MARKDOWN_FONT_SIZE_AUTO)}
              className={clsx(
                s.btn,
                s.btnCompact,
                localFs === MARKDOWN_FONT_SIZE_AUTO && s.btnActive,
              )}
              title={t('integrations.mdFontSizeAutoTooltip')}
            >
              {autoMdFs > 0
                ? `${t('display.autoLabel')} · ${autoMdFs}`
                : t('display.autoLabel')}
            </button>
            {MARKDOWN_FONT_SIZE_PRESETS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setFs(p)}
                className={clsx(s.btn, s.btnCompact, localFs === p && s.btnActive)}
              >
                {p}
              </button>
            ))}
            <input
              type="number"
              inputMode="numeric"
              min={MARKDOWN_FONT_SIZE_MIN}
              max={MARKDOWN_FONT_SIZE_MAX}
              value={fsInput}
              placeholder={t('display.customPlaceholder')}
              onChange={(e) => handleFsInput(e.target.value)}
              onBlur={handleFsBlur}
              className={s.numInput}
              aria-label={t('integrations.mdFontSizeCustomAriaLabel')}
            />
          </div>
        </section>
      </div>
    </Sheet>
  );
}
