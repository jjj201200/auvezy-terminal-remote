/**
 * ObsidianSettingsModal
 *
 * Obsidian 集成 5 子开关详细设置子 modal。形态对齐 ClaudeCodeSettingsModal:
 * Sheet 容器 + 顶部 hint + BoolToggleRow 列表。总开关在集成列表的
 * section row(与 Markdown 一致),不在此 modal。
 *
 * 编辑模型:受控 value/onChange,直接把值回写父 SettingsModal 的 draft —— 关闭
 * modal 不丢改动,跨多层 modal 仍是单一 dirty 检测点(与 ClaudeCodeSettingsModal 一致)。
 *
 * 子开关关闭行为不同(wikilink/embed 降级样式 vs inline/frontmatter 保留原文 vs
 * callout 回退普通 blockquote),顶部 hint 总说明,避免每行重复。
 */

import { useState, type JSX } from 'react';
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
  /** Obsidian 总开关当前值(只读 — 开关本体在集成列表 row;此值只用于子开关灰显) */
  enabled: boolean;
  /** 当前 5 子开关值 */
  value: ObsidianSubToggles;
  /** 子开关改动回调,父级 SettingsModal draft 接管落盘 */
  onChange: (next: ObsidianSubToggles) => void;
  /** Markdown 集成是否启用(用于区分「Markdown 关」与「Obsidian 自身关」两种 inactive 原因) */
  markdownEnabled: boolean;
}

export function ObsidianSettingsModal({
  open,
  onClose,
  enabled,
  value,
  onChange,
  markdownEnabled,
}: ObsidianSettingsModalProps): JSX.Element {
  const t = useT();

  // modal-stack entry 固化 present() 时的 props —— 受控 value 是打开瞬间的快照,
  // 连续切换会互相覆盖。编辑态在 modal 内部持有:mount 快照播种 + 本地累积 +
  // 每次变更上报 onChange。enabled / markdownEnabled 开关都不在本 modal 内,
  // props 冻结无影响。
  const [local, setLocal] = useState<ObsidianSubToggles>(value);
  const [localMarkdownEnabled] = useState(markdownEnabled);

  const setToggle = (key: keyof ObsidianSubToggles, next: boolean): void => {
    const nextToggles = { ...local, [key]: next };
    setLocal(nextToggles);
    onChange(nextToggles);
  };

  // 子开关 disable 条件:markdown 关 / obsidian 自身 enabled 关 任一即灰显
  const subDisabled = !(localMarkdownEnabled && enabled);

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

        {!localMarkdownEnabled && (
          <p className={`${s.note} ${s.noteInfo}`}>
            {t('obsidian.obsidianRequiresMarkdown')}
          </p>
        )}

        {/* 5 子开关 — Obsidian 真激活时才可点(总开关在集成列表 row,不在此) */}
        <BoolToggleRow
          title={t('obsidian.toggleFrontmatter')}
          hint={t('obsidian.toggleFrontmatterHint')}
          value={local.frontmatter}
          disabled={subDisabled}
          onChange={(v) => setToggle('frontmatter', v)}
        />
        <BoolToggleRow
          title={t('obsidian.toggleCallout')}
          hint={t('obsidian.toggleCalloutHint')}
          value={local.callout}
          disabled={subDisabled}
          onChange={(v) => setToggle('callout', v)}
        />
        <BoolToggleRow
          title={t('obsidian.toggleWikilink')}
          hint={t('obsidian.toggleWikilinkHint')}
          value={local.wikilink}
          disabled={subDisabled}
          onChange={(v) => setToggle('wikilink', v)}
        />
        <BoolToggleRow
          title={t('obsidian.toggleEmbed')}
          hint={t('obsidian.toggleEmbedHint')}
          value={local.embed}
          disabled={subDisabled}
          onChange={(v) => setToggle('embed', v)}
        />
        <BoolToggleRow
          title={t('obsidian.toggleInlineSyntax')}
          hint={t('obsidian.toggleInlineSyntaxHint')}
          value={local.inlineSyntax}
          disabled={subDisabled}
          onChange={(v) => setToggle('inlineSyntax', v)}
        />
      </div>
    </Sheet>
  );
}
