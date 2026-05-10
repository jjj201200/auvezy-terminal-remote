/**
 * DesignSystem
 *
 * 集中展示视觉系统：tokens、字体、间距、阴影、组件状态、组合模式、动效。
 * 独立展示页，不影响主应用。
 */

import { useState, type JSX, type ReactNode } from 'react';
import {
  IconSettings,
  IconSend,
  IconPlus,
  IconTrash,
  IconChevronRight,
  IconCheck,
  IconX,
  IconArrowDown,
  IconLayoutGrid,
  IconPencil,
} from '@tabler/icons-react';
import { Pill } from '../components/ui/Pill.js';
import { Toggle } from '../components/ui/Toggle.js';
import { TextField } from '../components/ui/TextField.js';
import { IconButton } from '../components/ui/IconButton.js';
import s from './DesignSystem.module.scss';

const COLOR_TOKENS = [
  { name: 'bg', value: '#08090b', desc: '主背景' },
  { name: 'bg-elev', value: '#0d0f12', desc: '悬浮层 / 卡片' },
  { name: 'bg-canvas', value: '#050608', desc: '终端 canvas' },
  { name: 'bg-input', value: '#0a0c0f', desc: '输入框' },
  { name: 'bg-hover', value: '#14171c', desc: 'hover 高亮' },
  { name: 'border', value: '#1a1d23', desc: '默认边框' },
  { name: 'border-hi', value: '#2a2f38', desc: '强调边框' },
  { name: 'fg', value: '#e6e7ea', desc: '主文字' },
  { name: 'fg-dim', value: '#8a8f99', desc: '次要文字' },
  { name: 'fg-low', value: '#50545d', desc: '禁用 / 占位' },
  { name: 'accent', value: '#b6f09c', desc: '磷光绿（主 accent）' },
  { name: 'alarm', value: '#ff6b6b', desc: '错误' },
  { name: 'warn', value: '#ffb84d', desc: '警告' },
];

const FONT_SIZES = [
  { token: 'fs-2xs', size: '10px', label: '2xs' },
  { token: 'fs-xs', size: '11px', label: 'xs' },
  { token: 'fs-sm', size: '12px', label: 'sm' },
  { token: 'fs-md', size: '13px (default)', label: 'md' },
  { token: 'fs-lg', size: '14px', label: 'lg' },
  { token: 'fs-xl', size: '16px', label: 'xl' },
  { token: 'fs-2xl', size: '18px', label: '2xl' },
];

const SPACING = [
  { name: 'sp-1', value: 2 },
  { name: 'sp-2', value: 4 },
  { name: 'sp-3', value: 6 },
  { name: 'sp-4', value: 8 },
  { name: 'sp-5', value: 12 },
  { name: 'sp-6', value: 16 },
  { name: 'sp-7', value: 20 },
  { name: 'sp-8', value: 24 },
  { name: 'sp-9', value: 32 },
];

export function DesignSystem(): JSX.Element {
  const [toggleOn, setToggleOn] = useState(false);
  const [textVal, setTextVal] = useState('');
  const [textErr, setTextErr] = useState('');

  return (
    <div className={s.root}>
      <div className={s.page}>
        {/* ─── HERO ─── */}
        <div className={s.heroSection}>
          <div className={s.heroBrand}>
            <span className={s.heroDot} />
            <span className={s.heroBrandName}>auvezy/terminal-remote · design system</span>
          </div>
          <h1 className={s.heroTitle}>
            Industrial mono.<br />
            <span>Phosphor accent.</span>
          </h1>
          <p className={s.heroDesc}>
            一套为远程终端控制场景设计的暗色系统。Geist Mono 全局等宽字体，磷光绿作为唯一强调色，
            工业级阴影分层，零圆角直角设计。本页集中呈现所有 tokens 与组件状态，便于审视一致性与张力。
          </p>
        </div>

        {/* ─── COLORS ─── */}
        <Section
          label="01"
          title="Color"
          desc="背景层、前景层、强调色、状态色四组。背景以接近黑（带 1° 冷调）的 5 档梯度区分 GUI / canvas / input / hover；前景仅 3 档暖白；强调色单一磷光绿。状态色仅 2 个（错误珊瑚红 + 警告琥珀）。"
        >
          <div className={s.colorGrid}>
            {COLOR_TOKENS.map((c) => (
              <div key={c.name} className={s.colorCard}>
                <div className={s.colorSwatch} style={{ background: c.value }} />
                <div className={s.colorMeta}>
                  <span className={s.colorName}>{c.name}</span>
                  <span className={s.colorValue}>{c.value}</span>
                  <span className={s.colorValue}>{c.desc}</span>
                </div>
              </div>
            ))}
          </div>
        </Section>

        {/* ─── TYPE ─── */}
        <Section
          label="02"
          title="Typography"
          desc="Geist Mono Variable（无衬线等宽），启用 ss01 / ss02 / cv11 / zero 字符变体让 a / g / 0 更几何更现代。所有 UI 文字都用同一字体——这是项目身份的核心记忆点。"
        >
          <div className={s.subsection}>
            <span className={s.subsectionTitle}>Scale</span>
            <div className={s.typeCard}>
              {FONT_SIZES.map((f) => (
                <div key={f.token} className={s.typeRow}>
                  <div className={s.typeMeta}>
                    <span className={s.typeMetaItem}>{f.label}</span>
                    <span className={s.typeMetaItem}>·</span>
                    <span className={s.typeMetaItem}>{f.size}</span>
                  </div>
                  <span className={`${s.typeSample} ${s[`fs${f.label.charAt(0).toUpperCase() + f.label.slice(1)}` as keyof typeof s] ?? ''}`}>
                    The quick brown fox jumps over 0123456789
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className={s.subsection}>
            <span className={s.subsectionTitle}>Numerics & glyphs</span>
            <div className={s.typeCard}>
              <div className={s.glyphRow}>
                <GlyphCell label="ZERO" char="0" />
                <GlyphCell label="ONE" char="1" />
                <GlyphCell label="A" char="a" />
                <GlyphCell label="G" char="g" />
                <GlyphCell label="L" char="l" />
                <GlyphCell label="ARROWS" char="→ ← ↑ ↓" />
                <GlyphCell label="EOF" char="⏎ ⇥ ⌫ ⏏" />
                <GlyphCell label="MOD" char="⌃ ⌥ ⇧ ⌘" />
              </div>
            </div>
          </div>
        </Section>

        {/* ─── SPACING ─── */}
        <Section
          label="03"
          title="Spacing"
          desc="2px 起步的紧凑梯度，避免 Tailwind 4px 起步在终端类 UI 上偏松散。日常布局集中用 sp-2 (4) / sp-3 (6) / sp-4 (8) / sp-5 (12)，更大的留给 section 间距。"
        >
          <div className={s.typeCard}>
            {SPACING.map((sp) => (
              <div key={sp.name} className={s.spacingRow}>
                <span className={s.spacingName}>{sp.name}</span>
                <span className={s.spacingBar} style={{ width: sp.value }} />
                <span className={s.spacingValue}>{sp.value}px</span>
              </div>
            ))}
          </div>
        </Section>

        {/* ─── SHADOWS ─── */}
        <Section
          label="04"
          title="Shadow"
          desc="工业级三层阴影：顶部高光 + 长投影 + 蚀刻边。给悬浮层带来真实深度感而非 Web 风格的圆角浮起。"
        >
          <div className={s.shadowGrid}>
            <div className={s.shadowCard} style={{ boxShadow: 'var(--shadow-1)' }}>shadow-1</div>
            <div className={s.shadowCard} style={{ boxShadow: 'var(--shadow-2)' }}>shadow-2</div>
            <div className={s.shadowCard} style={{ boxShadow: 'var(--shadow-3)' }}>shadow-3</div>
          </div>
        </Section>

        {/* ─── BUTTONS ─── */}
        <Section
          label="05"
          title="Buttons"
          desc="所有按钮都是直角、等宽字体、克制的过渡。强调色按钮用磷光绿底配深色文字（反白）；ghost 按钮 hover 时背景变成 bg-hover；图标按钮在 mobile 触控目标 36×36，桌面 28×28。"
        >
          <div className={s.demoGrid}>
            <DemoCard label="Primary">
              <div className={s.demoRow}>
                <PrimaryBtn>Authenticate</PrimaryBtn>
                <PrimaryBtn disabled>Disabled</PrimaryBtn>
              </div>
              <span className={s.demoCode}>{`<button class="primary">Authenticate</button>`}</span>
            </DemoCard>

            <DemoCard label="Secondary">
              <div className={s.demoRow}>
                <SecondaryBtn>Cancel</SecondaryBtn>
                <SecondaryBtn disabled>Disabled</SecondaryBtn>
              </div>
              <span className={s.demoCode}>{`<button class="secondary">Cancel</button>`}</span>
            </DemoCard>

            <DemoCard label="Icon · Ghost">
              <div className={s.demoRow}>
                <IconButton aria-label="settings"><IconSettings size={14} stroke={1.5} /></IconButton>
                <IconButton aria-label="add"><IconPlus size={14} stroke={1.5} /></IconButton>
                <IconButton aria-label="trash"><IconTrash size={14} stroke={1.5} /></IconButton>
                <IconButton aria-label="close"><IconX size={14} stroke={1.5} /></IconButton>
                <IconButton aria-label="layout"><IconLayoutGrid size={14} stroke={1.5} /></IconButton>
                <IconButton aria-label="check"><IconCheck size={14} stroke={1.5} /></IconButton>
                <IconButton aria-label="pencil"><IconPencil size={14} stroke={1.5} /></IconButton>
                <IconButton aria-label="arrow"><IconArrowDown size={14} stroke={1.5} /></IconButton>
              </div>
              <span className={s.demoCode}>{`<IconButton><IconSettings /></IconButton>`}</span>
            </DemoCard>

            <DemoCard label="Icon · Accent">
              <div className={s.demoRow}>
                <IconButton variant="accent" aria-label="send"><IconSend size={14} stroke={1.5} /></IconButton>
                <IconButton variant="accent" aria-label="check"><IconCheck size={14} stroke={1.5} /></IconButton>
              </div>
              <span className={s.demoCode}>{`<IconButton variant="accent">…</IconButton>`}</span>
            </DemoCard>
          </div>
        </Section>

        {/* ─── PILLS ─── */}
        <Section
          label="06"
          title="Pills"
          desc="状态徽标：胶囊形（仅这种保留圆角），左侧有一个 6px 同色方块作状态点。所有 tone 都极低饱和，不抢主体注意力。"
        >
          <div className={s.demoGrid}>
            <DemoCard label="All tones">
              <div className={s.demoRow}>
                <Pill tone="ok">connected</Pill>
                <Pill tone="warn">connecting</Pill>
                <Pill tone="error">disconnected</Pill>
                <Pill tone="muted">idle</Pill>
                <Pill tone="accent">running</Pill>
              </div>
            </DemoCard>
          </div>
        </Section>

        {/* ─── INPUTS ─── */}
        <Section
          label="07"
          title="Form controls"
          desc="所有输入控件无圆角，focus 时边框换 accent + 1px 同色 ring；hover 时边框稍亮一档；错误态边框用 alarm 红。Toggle 用磷光绿底 + 深色 thumb（反白）。"
        >
          <div className={s.demoGrid}>
            <DemoCard label="TextField">
              <div className={s.demoBody}>
                <TextField placeholder="empty" />
                <TextField defaultValue="Geist Mono variable woff2" mono />
                <TextField defaultValue="invalid input" error="格式不合法" />
                <TextField defaultValue="disabled" disabled />
              </div>
            </DemoCard>

            <DemoCard label="Toggle">
              <div className={s.demoBody}>
                <Toggle checked={toggleOn} onCheckedChange={setToggleOn} label="enabled" />
                <Toggle checked={false} onCheckedChange={() => {}} label="off" />
                <Toggle checked={true} onCheckedChange={() => {}} label="on" />
                <Toggle checked={false} onCheckedChange={() => {}} disabled label="disabled" />
              </div>
            </DemoCard>

            <DemoCard label="Interactive">
              <div className={s.demoBody}>
                <TextField
                  placeholder="type something"
                  value={textVal}
                  onChange={(e) => {
                    setTextVal(e.target.value);
                    setTextErr(e.target.value.length > 8 ? '不能超过 8 字符' : '');
                  }}
                  error={textErr || undefined}
                  helper={textErr ? undefined : '试着输入超过 8 字符'}
                />
              </div>
            </DemoCard>
          </div>
        </Section>

        {/* ─── PATTERNS ─── */}
        <Section
          label="08"
          title="Patterns"
          desc="组合用法：登录卡片、顶栏、快捷键栏、Toast。展示组件如何组合成可识别的视觉模块。"
        >
          <div className={s.subsection}>
            <span className={s.subsectionTitle}>Auth card</span>
            <PatternFrame title="auth · /">
              <AuthDemo />
            </PatternFrame>
          </div>

          <div className={s.subsection}>
            <span className={s.subsectionTitle}>Top bar</span>
            <PatternFrame title="console · header">
              <TopBarDemo />
            </PatternFrame>
          </div>

          <div className={s.subsection}>
            <span className={s.subsectionTitle}>Shortcuts row</span>
            <PatternFrame title="console · shortcuts bar">
              <ShortcutsDemo />
            </PatternFrame>
          </div>

          <div className={s.subsection}>
            <span className={s.subsectionTitle}>Input bar</span>
            <PatternFrame title="console · input">
              <InputDemo />
            </PatternFrame>
          </div>
        </Section>

        {/* ─── MOTION ─── */}
        <Section
          label="09"
          title="Motion"
          desc="克制：仅在 hover、focus、modal 进入时使用 100-180ms ease 过渡。无 transform 抬升、无大幅度 scale，避免 Web 设计感。一个 4×4 像素的呼吸点是项目的视觉脉搏。"
        >
          <div className={s.demoGrid}>
            <DemoCard label="Pulse beacon">
              <div className={s.hoverRow}>
                <span className={s.heroDot} />
                <span className={s.hoverHint}>pulse · 2s · ease</span>
              </div>
            </DemoCard>

            <DemoCard label="Hover transition">
              <div className={s.demoRow}>
                <SecondaryBtn>Hover me</SecondaryBtn>
                <span className={s.demoCode}>120ms ease</span>
              </div>
            </DemoCard>
          </div>
        </Section>

        <footer className={s.footer}>
          design system v0.1 · auvezy/terminal-remote
        </footer>
      </div>
    </div>
  );
}

// ============================================================
// 局部组件
// ============================================================

function Section({
  label,
  title,
  desc,
  children,
}: {
  label: string;
  title: string;
  desc: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <section className={s.section}>
      <header className={s.sectionHead}>
        <span className={s.sectionLabel}>{label} · section</span>
        <h2 className={s.sectionTitle}>{title}</h2>
        <p className={s.sectionDesc}>{desc}</p>
      </header>
      {children}
    </section>
  );
}

function DemoCard({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return (
    <div className={s.demoCard}>
      <span className={s.demoLabel}>{label}</span>
      {children}
    </div>
  );
}

function GlyphCell({ label, char }: { label: string; char: string }): JSX.Element {
  return (
    <div className={s.glyphCell}>
      <span>{char}</span>
      <span className={s.glyphLabel}>{label}</span>
    </div>
  );
}

function PrimaryBtn({
  children,
  disabled,
}: {
  children: ReactNode;
  disabled?: boolean;
}): JSX.Element {
  return (
    <button type="button" disabled={disabled} className={s.demoBtnPrimary}>
      {children}
    </button>
  );
}

function SecondaryBtn({
  children,
  disabled,
}: {
  children: ReactNode;
  disabled?: boolean;
}): JSX.Element {
  return (
    <button type="button" disabled={disabled} className={s.demoBtnSecondary}>
      {children}
    </button>
  );
}

function PatternFrame({ title, children }: { title: string; children: ReactNode }): JSX.Element {
  return (
    <div className={s.patternFrame}>
      <div className={s.patternFrameHead}>
        <span className={s.patternFrameDot} />
        <span className={s.patternFrameDot} />
        <span className={s.patternFrameDot} />
        <span className={s.patternFrameTitle}>{title}</span>
      </div>
      <div className={s.patternFrameBody}>{children}</div>
    </div>
  );
}

// ─── Pattern demos ───

function AuthDemo(): JSX.Element {
  return (
    <div className={s.authCard}>
      <div className={s.authBrand}>
        <span className={s.heroDot} />
        <span className={s.authBrandName}>auvezy/terminal-remote</span>
      </div>
      <h3 className={s.authTitle}>Authenticate</h3>
      <p className={s.authSubtitle}>Enter the access token shown when the server started.</p>
      <div className={s.authForm}>
        <span className={s.authFieldLabel}>Access token</span>
        <input
          type="password"
          defaultValue="••••••••••••••••"
          className={s.authInput}
        />
        <PrimaryBtn>Authenticate</PrimaryBtn>
      </div>
    </div>
  );
}

function TopBarDemo(): JSX.Element {
  return (
    <div className={s.topBar}>
      <button type="button" className={`${s.topBarTab} ${s.topBarTabActive}`}>
        default<span className={s.topBarPort}>:3737</span>
      </button>
      <button type="button" className={s.topBarTab}>
        build<span className={s.topBarPort}>:3001</span>
      </button>
      <IconButton aria-label="add"><IconPlus size={12} stroke={1.5} /></IconButton>
      <div className={s.topBarSpacer} />
      <Pill tone="ok">connected</Pill>
      <Pill tone="warn">waiting</Pill>
      <IconButton aria-label="settings"><IconSettings size={14} stroke={1.5} /></IconButton>
    </div>
  );
}

function ShortcutsDemo(): JSX.Element {
  const cats = ['Common', 'Editing', 'Readline', 'Vim', 'tmux'];
  const [active, setActive] = useState('Common');
  const keysByCategory: Record<string, string[]> = {
    Common: ['Esc', 'Enter', 'Tab', 'BkSp', '↑', '↓', '←', '→', 'S-Tab'],
    Editing: ['^C', '^D', '^L', '^U', '^K', '^W', '^A', '^E', '^Z'],
    Readline: ['⌥←', '⌥→', '^R', '^S', '^T', '^Y', '^_', '⌥D', '⌥.'],
    Vim: [':w', ':q', ':wq', ':q!', 'gg', 'G', 'u', '^R', '/', 'n'],
    tmux: ['tm:c', 'tm:n', 'tm:p', 'tm:d', 'tm:%', 'tm:"', 'tm:x'],
  };
  return (
    <div className={s.shortcutsDemo}>
      <div className={s.shortcutsCats}>
        {cats.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setActive(c)}
            className={`${s.shortcutsCat} ${active === c ? s.shortcutsCatActive : ''}`}
          >
            {c}
          </button>
        ))}
      </div>
      <div className={s.shortcutsKeys}>
        {(keysByCategory[active] ?? []).map((k) => (
          <button key={k} type="button" className={s.shortcutsKey}>
            {k}
          </button>
        ))}
      </div>
    </div>
  );
}

function InputDemo(): JSX.Element {
  return (
    <div className={s.inputDemoBar}>
      <input
        defaultValue="git status --short"
        className={s.inputDemoInput}
      />
      <IconButton variant="accent" aria-label="send"><IconSend size={14} stroke={1.5} /></IconButton>
      <IconButton aria-label="settings"><IconSettings size={14} stroke={1.5} /></IconButton>
    </div>
  );
}
