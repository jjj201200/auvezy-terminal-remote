/**
 * ObsidianSettingsModal
 *
 * Obsidian 集成 5 子开关详细设置子 modal。形态对齐 ClaudeCodeSettingsModal:
 * Sheet 容器 + 顶部 hint + BoolToggleRow 列表。
 *
 * 编辑模型:受控 value/onChange,直接把值回写父 SettingsModal 的 draft —— 关闭
 * modal 不丢改动,跨多层 modal 仍是单一 dirty 检测点(与 ClaudeCodeSettingsModal 一致)。
 *
 * 子开关关闭行为不同(wikilink/embed 降级样式 vs inline/frontmatter 保留原文 vs
 * callout 回退普通 blockquote),顶部 hint 总说明,避免每行重复。
 */

import { type JSX } from 'react';
import { Sheet } from '../ui/Sheet.js';
import { useT } from '../../i18n/i18n-context.js';
import { BoolToggleRow } from './BoolToggleRow.js';
import s from './GeneralSettings.module.scss';

/** Obsidian 5 子开关值 — 与 RenderingIntegrationPrefs.obsidian 同形,但全是 boolean 必填 */
export interface ObsidianSubToggles {
  frontmatter: boolean;
  wikilink: boolean;
  embed: boolean;
  callout: boolean;
  inlineSyntax: boolean;
}

export interface ObsidianSettingsModalProps {
  open: boolean;
  onClose: () => void;
  /** 当前子开关值 */
  value: ObsidianSubToggles;
  /** 改动回调,父级 SettingsModal draft 接管落盘 */
  onChange: (next: ObsidianSubToggles) => void;
  /** Obsidian 集成当前是否会被激活(rendering.markdown.enabled && rendering.obsidian.enabled) */
  active: boolean;
}

export function ObsidianSettingsModal({
  open,
  onClose,
  value,
  onChange,
  active,
}: ObsidianSettingsModalProps): JSX.Element {
  const t = useT();

  const setToggle = (key: keyof ObsidianSubToggles, next: boolean): void => {
    onChange({ ...value, [key]: next });
  };

  const disabled = !active;

  return (
    <Sheet
      id="obsidian-settings-modal"
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={t('obsidian.obsidianModalTitle')}
    >
      <div className={s.root}>
        <p className={s.hint}>{t('obsidian.obsidianModalHint')}</p>

        {!active && (
          <p className={`${s.note} ${s.noteInfo}`}>
            {t('obsidian.obsidianRequiresMarkdown')}
          </p>
        )}

        <BoolToggleRow
          title={t('obsidian.toggleFrontmatter')}
          hint={t('obsidian.toggleFrontmatterHint')}
          value={value.frontmatter}
          disabled={disabled}
          onChange={(v) => setToggle('frontmatter', v)}
        />
        <BoolToggleRow
          title={t('obsidian.toggleCallout')}
          hint={t('obsidian.toggleCalloutHint')}
          value={value.callout}
          disabled={disabled}
          onChange={(v) => setToggle('callout', v)}
        />
        <BoolToggleRow
          title={t('obsidian.toggleWikilink')}
          hint={t('obsidian.toggleWikilinkHint')}
          value={value.wikilink}
          disabled={disabled}
          onChange={(v) => setToggle('wikilink', v)}
        />
        <BoolToggleRow
          title={t('obsidian.toggleEmbed')}
          hint={t('obsidian.toggleEmbedHint')}
          value={value.embed}
          disabled={disabled}
          onChange={(v) => setToggle('embed', v)}
        />
        <BoolToggleRow
          title={t('obsidian.toggleInlineSyntax')}
          hint={t('obsidian.toggleInlineSyntaxHint')}
          value={value.inlineSyntax}
          disabled={disabled}
          onChange={(v) => setToggle('inlineSyntax', v)}
        />
      </div>
    </Sheet>
  );
}
