/**
 * DiscoveryModal
 *
 * Skill / MCP 自动发现结果的选择列表。从 Toolbar「常用」「会话」组的
 * Skill·MCP 入口按钮打开，数据来自 GET /api/discovery（backend 扫描
 * claude / codex 的固定配置目录）。
 *
 * 交互（与命令按钮的 prefill / autoSend 语义对齐）：
 *  - 点 skill 行 → onPickSkill(invoke) 填入输入框（invoke 自带尾随空格，
 *    如 "/deploy " / "$skill-name "，留给用户补参数）→ 关闭
 *  - 点 MCP 行 / 底部按钮 → onSubmitMcp() 直发 "/mcp"（打开 TUI 自己的
 *    MCP 管理界面；server 级操作 reconnect/enable 等都在那里面）→ 关闭
 *
 * 数据在 open 时拉取一次（不轮询；skill 目录改动可在 TUI 里 /reload-skills）。
 */

import { useCallback, useEffect, useState, type JSX } from 'react';
import type { DiscoveredMcpServer, DiscoveredSkill } from 'auvezy-terminal-remote-shared';
import { Sheet } from '../ui/Sheet.js';
import { useT } from '../../i18n/i18n-context.js';
import { fetchDiscovery } from '../../services/discovery-api.js';
import s from './DiscoveryModal.module.scss';

export interface DiscoveryModalProps {
  open: boolean;
  onClose: () => void;
  /** 实例 id（backend 按其 cwd 扫描项目级 .claude / .agents / .codex） */
  instanceId: string;
  /** 选中 skill：把 invoke（含尾随空格）填入输入框 */
  onPickSkill: (invoke: string) => void;
  /** MCP 区动作：直发 /mcp */
  onSubmitMcp: () => void;
}

type LoadState =
  | { phase: 'loading' }
  | { phase: 'error' }
  | { phase: 'done'; skills: DiscoveredSkill[]; mcpServers: DiscoveredMcpServer[] };

export function DiscoveryModal({
  open,
  onClose,
  instanceId,
  onPickSkill,
  onSubmitMcp,
}: DiscoveryModalProps): JSX.Element {
  const t = useT();
  const [state, setState] = useState<LoadState>({ phase: 'loading' });

  const load = useCallback(async () => {
    setState({ phase: 'loading' });
    const res = await fetchDiscovery(instanceId);
    if (!res.ok || !res.data) {
      setState({ phase: 'error' });
      return;
    }
    setState({
      phase: 'done',
      skills: res.data.skills,
      mcpServers: res.data.mcpServers,
    });
  }, [instanceId]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const pickSkill = (skill: DiscoveredSkill): void => {
    onPickSkill(skill.invoke);
    onClose();
  };
  const sendMcp = (): void => {
    onSubmitMcp();
    onClose();
  };

  const claudeSkills = state.phase === 'done' ? state.skills.filter((x) => x.tui === 'claude') : [];
  const codexSkills = state.phase === 'done' ? state.skills.filter((x) => x.tui === 'codex') : [];

  return (
    <Sheet
      id="discovery-modal"
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={t('discovery.title')}
    >
      <div className={s.root}>
        {state.phase === 'loading' && <p className={s.hint}>{t('discovery.loading')}</p>}

        {state.phase === 'error' && (
          <div className={s.hintBlock}>
            <p className={s.hint}>{t('discovery.loadError')}</p>
            <button type="button" className={s.retry} onClick={() => void load()}>
              {t('discovery.retry')}
            </button>
          </div>
        )}

        {state.phase === 'done' &&
          state.skills.length === 0 &&
          state.mcpServers.length === 0 && (
            <div className={s.hintBlock}>
              <p className={s.hint}>{t('discovery.empty')}</p>
              <p className={s.hintSub}>{t('discovery.emptyHint')}</p>
            </div>
          )}

        {state.phase === 'done' && state.skills.length > 0 && (
          <section className={s.section}>
            <header className={s.sectionHead}>
              <span className={s.sectionTitle}>{t('discovery.skillsSection')}</span>
              <span className={s.sectionHint}>{t('discovery.pickHint')}</span>
            </header>
            <SkillRows tui="claude" label={t('discovery.tuiClaude')} skills={claudeSkills} onPick={pickSkill} />
            <SkillRows tui="codex" label={t('discovery.tuiCodex')} skills={codexSkills} onPick={pickSkill} />
          </section>
        )}

        {state.phase === 'done' && state.mcpServers.length > 0 && (
          <section className={s.section}>
            <header className={s.sectionHead}>
              <span className={s.sectionTitle}>{t('discovery.mcpSection')}</span>
              <span className={s.sectionHint}>{t('discovery.mcpHint')}</span>
            </header>
            {state.mcpServers.map((m) => (
              <button
                type="button"
                key={`${m.tui}-${m.source}-${m.name}`}
                className={s.row}
                onClick={sendMcp}
              >
                <span className={s.rowMain}>
                  <span className={s.rowTitle}>
                    <span className={`${s.badge} ${s.badgeTui}`}>{m.tui}</span>
                    {m.name}
                  </span>
                  {m.detail && <span className={s.rowDetail}>{m.detail}</span>}
                </span>
                <span className={s.rowMeta}>
                  <span className={s.badge}>{m.transport}</span>
                  <span className={s.badge}>
                    {m.source === 'user' ? t('discovery.sourceUser') : t('discovery.sourceProject')}
                  </span>
                </span>
              </button>
            ))}
          </section>
        )}
      </div>
    </Sheet>
  );
}

/** 单个 TUI 的 skill 行组（空则整组不渲染） */
function SkillRows({
  tui,
  label,
  skills,
  onPick,
}: {
  tui: 'claude' | 'codex';
  label: string;
  skills: DiscoveredSkill[];
  onPick: (skill: DiscoveredSkill) => void;
}): JSX.Element | null {
  const t = useT();
  if (skills.length === 0) return null;
  return (
    <div className={s.tuiBlock}>
      <div className={s.tuiLabel}>{label}</div>
      {skills.map((skill) => (
        <button
          type="button"
          key={`${tui}-${skill.source}-${skill.kind}-${skill.name}`}
          className={s.row}
          onClick={() => onPick(skill)}
        >
          <span className={s.rowMain}>
            <span className={s.rowTitle}>
              <span className={s.rowName}>{skill.name}</span>
              {skill.kind === 'command' && (
                <span className={s.badge}>{t('discovery.kindCommand')}</span>
              )}
            </span>
            {skill.description && <span className={s.rowDetail}>{skill.description}</span>}
          </span>
          <span className={s.rowMeta}>
            <span className={`${s.badge} ${s.badgeAccent}`}>{skill.invoke.trim()}</span>
            <span className={s.badge}>
              {skill.source === 'user' ? t('discovery.sourceUser') : t('discovery.sourceProject')}
            </span>
          </span>
        </button>
      ))}
    </div>
  );
}
