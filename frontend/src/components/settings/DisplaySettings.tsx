/**
 * DisplaySettings
 *
 * 终端显示偏好：目标列数（自适应字号）+ 字间距。
 *
 * 列数：
 *  - 0 = 关闭自适应（用默认字号 13px）
 *  - 80/100/120 三个预设按钮一键切换
 *  - 自定义输入：[40, 240]
 *
 * 字间距：
 *  - 范围 [-2, 4]，0 = 默认
 *  - 滑块 + 数值同步
 *
 * 即时生效：用户调一项 → setDraft → useTerminal 收到 effect 立即重应用
 */

import { useState, useEffect, useMemo, useRef, type JSX } from 'react';
import { IconChevronDown, IconCheck } from '@tabler/icons-react';
import {
  DEFAULT_DISPLAY,
  FONT_SIZE_MIN,
  FONT_SIZE_MAX,
  LETTER_SPACING_MIN,
  LETTER_SPACING_MAX,
  type DisplayPrefs,
  type TerminalThemeName,
} from 'auvezy-terminal-remote-shared';
import clsx from 'clsx';
import { XTERM_FONT_SIZE } from '../../config/constants.js';
import { useT } from '../../i18n/i18n-context.js';
import { THEME_LIST, resolveTheme } from '../../themes/terminal-themes.js';
import s from './DisplaySettings.module.scss';

// 与 useTerminal 同源：mono 字符宽度 / fontSize 比例
const CHAR_WIDTH_RATIO = 0.6;

// THEME_LIST.labelKey → i18n key（避免运行时 key 拼接的 type-cast 问题）
const THEME_LABEL_KEY = {
  dark: 'display.themeDark',
  light: 'display.themeLight',
  darkAnsi: 'display.themeDarkAnsi',
  lightAnsi: 'display.themeLightAnsi',
  darkDaltonized: 'display.themeDarkDaltonized',
  lightDaltonized: 'display.themeLightDaltonized',
  auto: 'display.themeAuto',
} as const;

/** 抽出"色块条 + 主题名"组合，trigger 和列表项都用 */
function ThemeRowContent(props: {
  meta: (typeof THEME_LIST)[number];
  t: ReturnType<typeof useT>;
}): JSX.Element {
  const { meta, t } = props;
  const colors = resolveTheme(meta.key);
  return (
    <>
      <span className={s.themeSwatch} aria-hidden="true">
        <span style={{ background: colors.background }} />
        <span style={{ background: colors.brightRed }} />
        <span style={{ background: colors.brightGreen }} />
        <span style={{ background: colors.brightYellow }} />
        <span style={{ background: colors.brightBlue }} />
        <span style={{ background: colors.brightMagenta }} />
      </span>
      <span className={s.themeLabel}>{t(THEME_LABEL_KEY[meta.labelKey])}</span>
    </>
  );
}

/**
 * 与 useTerminal 中 computeFontPrefs 同算法
 * targetCols=0 → 用默认字号；否则按参考宽度反推
 *
 * 这里的「参考宽度」必须是稳定值（不随预览容器抖动）。预览容器一旦因为
 * sheet body 出现滚动条而改变宽度，会反推回不同字号，造成"调列数下面就跳字号"
 * 的视觉 bug。所以我们传 window.innerWidth —— 这接近真实终端会用的宽度。
 */
function computePreviewFontSize(
  referenceWidth: number,
  targetCols: number,
  letterSpacing: number,
): number {
  if (!targetCols || targetCols <= 0 || referenceWidth <= 0) return XTERM_FONT_SIZE;
  const raw = (referenceWidth / targetCols - letterSpacing) / CHAR_WIDTH_RATIO;
  return Math.max(FONT_SIZE_MIN, Math.min(FONT_SIZE_MAX, Math.floor(raw)));
}

export interface DisplaySettingsProps {
  value: DisplayPrefs | undefined;
  onChange: (next: DisplayPrefs) => void;
}

// 输入框接受的范围（可超出预设）
const COLS_MIN = 40;
const COLS_MAX = 150;

/**
 * 根据当前屏幕宽度算"有意义的列数预设"
 *
 * 同一字号下相邻 cols 视觉无差别——`fontSize = floor(W / cols / 0.6)` clamp 到
 * [8, 18]。所以对每个可能的 fontSize 反推一个 cols 即可覆盖所有视觉档位。
 *
 * 算法：fontSize 从 18 → 8 遍历，每个算 `cols = floor(W / fontSize / 0.6)`，
 * 落在 [COLS_MIN, COLS_MAX] 内的去重收集。结果按升序返回。
 */
function computeMeaningfulPresets(width: number): number[] {
  if (width <= 0) return [80, 100, 120, 220];
  const set = new Set<number>();
  for (let fs = FONT_SIZE_MAX; fs >= FONT_SIZE_MIN; fs--) {
    const cols = Math.floor(width / fs / CHAR_WIDTH_RATIO);
    if (cols >= COLS_MIN && cols <= COLS_MAX) set.add(cols);
  }
  return Array.from(set).sort((a, b) => a - b);
}

export function DisplaySettings({ value, onChange }: DisplaySettingsProps): JSX.Element {
  const t = useT();
  const targetCols = value?.targetCols ?? DEFAULT_DISPLAY.targetCols;
  const letterSpacing = value?.letterSpacing ?? DEFAULT_DISPLAY.letterSpacing;
  const theme = value?.theme ?? DEFAULT_DISPLAY.theme;
  // 预览也用当前主题色，让用户改主题立即看到效果
  const palette = useMemo(() => resolveTheme(theme), [theme]);

  // 自定义列数输入框：与 targetCols 双向绑定，但允许输入中途为空
  const [colsInput, setColsInput] = useState<string>(targetCols > 0 ? String(targetCols) : '');
  useEffect(() => {
    setColsInput(targetCols > 0 ? String(targetCols) : '');
  }, [targetCols]);

  // ──────────────── 参考宽度（用于反推字号 / 预设列数）────────────────
  // 不再用预览容器实时宽度——sheet body 一旦因为下拉展开/收起触发滚动条出现
  // 容器宽度抖动几像素，ResizeObserver 就会反推出不同字号，造成"调下面字号跳"
  // 的视觉 bug。改用 window.innerWidth：它代表真实终端会拿到的宽度，与预览
  // 容器的临时尺寸无关，只在窗口 resize 时变化。
  const [referenceWidth, setReferenceWidth] = useState<number>(
    () => (typeof window !== 'undefined' ? window.innerWidth : 0),
  );
  useEffect(() => {
    const onResize = (): void => setReferenceWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const previewFontSize = computePreviewFontSize(referenceWidth, targetCols, letterSpacing);

  // 用「参考宽度」反推预设——保持稳定，不随 sheet 内滚动条抖动
  const presets = useMemo(() => computeMeaningfulPresets(referenceWidth), [referenceWidth]);
  // Auto 模式下使用默认字号 XTERM_FONT_SIZE，对应一个 cols
  // 把它从预设里去掉避免重复，并用来给 Auto 按钮显示具体数值
  const autoCols = useMemo(() => {
    if (referenceWidth <= 0) return 0;
    return Math.floor(referenceWidth / XTERM_FONT_SIZE / CHAR_WIDTH_RATIO);
  }, [referenceWidth]);
  const presetsWithoutAuto = useMemo(
    () => presets.filter((p) => p !== autoCols),
    [presets, autoCols],
  );

  const setCols = (n: number): void => {
    onChange({ ...value, targetCols: n });
  };

  const handleColsInput = (v: string): void => {
    setColsInput(v);
    if (v === '') return;
    const n = Number(v);
    if (!Number.isInteger(n)) return;
    if (n < COLS_MIN || n > COLS_MAX) return;
    setCols(n);
  };

  const handleColsBlur = (): void => {
    if (colsInput === '') {
      // 留空 = 关闭自适应
      setCols(0);
      return;
    }
    const n = Number(colsInput);
    if (!Number.isInteger(n)) {
      setColsInput(targetCols > 0 ? String(targetCols) : '');
      return;
    }
    setCols(Math.max(COLS_MIN, Math.min(COLS_MAX, n)));
  };

  const setLetterSpacing = (n: number): void => {
    const clamped = Math.max(LETTER_SPACING_MIN, Math.min(LETTER_SPACING_MAX, n));
    onChange({ ...value, letterSpacing: clamped });
  };

  const setTheme = (next: TerminalThemeName): void => {
    onChange({ ...value, theme: next });
    setThemeOpen(false);
  };

  const [themeOpen, setThemeOpen] = useState(false);
  const themeSelectRef = useRef<HTMLDivElement | null>(null);
  // 点击外部 / Esc 关闭主题下拉
  useEffect(() => {
    if (!themeOpen) return;
    const onPointerDown = (e: PointerEvent): void => {
      const root = themeSelectRef.current;
      if (root && e.target instanceof Node && !root.contains(e.target)) {
        setThemeOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setThemeOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [themeOpen]);

  const currentThemeMeta = useMemo(
    () => THEME_LIST.find((m) => m.key === theme) ?? THEME_LIST[0]!,
    [theme],
  );

  return (
    <div className={s.root}>
      {/* 预览：sticky 在 tab body 顶部，让用户在下方滚动调参时始终能看到效果。
          颜色用 palette（resolveTheme(theme) 的结果）→ 改主题立即同步 */}
      <section className={clsx(s.section, s.previewSection)}>
        <header className={s.sectionHeader}>
          <h3 className={s.sectionTitle}>{t('display.previewTitle')}</h3>
          <p className={s.sectionHint}>{t('display.previewHint')}</p>
        </header>
        <div
          className={s.preview}
          style={{
            fontSize: `${previewFontSize}px`,
            letterSpacing: `${letterSpacing}px`,
            background: palette.background,
            color: palette.foreground,
          }}
        >
          <div className={s.previewLine}>
            <span style={{ color: palette.brightGreen }}>user@host</span>
            <span style={{ color: palette.brightBlack }}>:</span>
            <span style={{ color: palette.brightBlue }}>~/projects</span>
            <span style={{ color: palette.brightBlack }}>$ </span>
            <span style={{ color: palette.foreground }}>ls -la</span>
          </div>
          <div className={s.previewLine}>
            <span style={{ color: palette.brightBlack }}>drwxr-xr-x </span>
            <span style={{ color: palette.brightBlue }}>4 </span>
            <span style={{ color: palette.foreground }}>user </span>
            <span style={{ color: palette.brightBlack }}>4096 </span>
            <span style={{ color: palette.brightGreen }}>May 06 02:34 </span>
            <span style={{ color: palette.foreground }}>src/</span>
          </div>
          <div className={s.previewLine}>
            <span style={{ color: palette.brightRed }}>error</span>
            <span style={{ color: palette.brightBlack }}>: </span>
            <span style={{ color: palette.foreground }}>cannot find module </span>
            <span style={{ color: palette.brightYellow }}>'./missing'</span>
          </div>
          <div
            className={s.previewMeta}
            style={{ color: palette.brightBlack, borderTopColor: palette.brightBlack }}
          >
            {t('display.previewMeta', {
              size: previewFontSize,
              ls: letterSpacing.toFixed(1),
              cols: targetCols > 0
                ? t('display.colsModeTarget', { cols: targetCols })
                : t('display.colsModeAuto'),
            })}
          </div>
        </div>
      </section>

      {/* 调色板主题：默认折叠只显示当前选中；点击展开看全部 */}
      <section className={s.section}>
        <header className={s.sectionHeader}>
          <h3 className={s.sectionTitle}>{t('display.themeTitle')}</h3>
          <p className={s.sectionHint}>{t('display.themeHint')}</p>
        </header>
        <div className={s.themeSelect} ref={themeSelectRef}>
          <button
            type="button"
            onClick={() => setThemeOpen((v) => !v)}
            className={clsx(s.themeItem, s.themeTrigger)}
            aria-expanded={themeOpen}
            aria-haspopup="listbox"
          >
            <ThemeRowContent meta={currentThemeMeta} t={t} />
            <IconChevronDown
              size={14}
              stroke={1.5}
              className={clsx(s.themeChevron, themeOpen && s.themeChevronOpen)}
            />
          </button>
          {themeOpen && (
            <ul className={s.themeList} role="listbox">
              {THEME_LIST.map((meta) => {
                const active = theme === meta.key;
                return (
                  <li key={meta.key} role="option" aria-selected={active}>
                    <button
                      type="button"
                      onClick={() => setTheme(meta.key)}
                      className={clsx(s.themeItem, active && s.themeItemActive)}
                    >
                      <ThemeRowContent meta={meta} t={t} />
                      {active && <IconCheck size={14} stroke={1.5} className={s.themeCheck} />}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>

      {/* 列数 */}
      <section className={s.section}>
        <header className={s.sectionHeader}>
          <h3 className={s.sectionTitle}>{t('display.targetColsTitle')}</h3>
          <p className={s.sectionHint}>{t('display.targetColsHint')}</p>
        </header>

        <div className={s.row}>
          <button
            type="button"
            onClick={() => setCols(0)}
            className={clsx(s.presetBtn, targetCols === 0 && s.presetBtnActive)}
            title={t('display.autoTooltip')}
          >
            {autoCols > 0 ? `${t('display.autoLabel')} · ${autoCols}` : t('display.autoLabel')}
          </button>
          {/*
            预设按钮：根据当前预览宽度反推"有意义的列数"——同字号下的相邻 cols
            视觉无差别，只列出会真实改变 fontSize 的 cols 值。
            过滤掉与 Auto 模式相同的 cols（避免按钮重复）。
            数字输入框接受超出预设的值（[40, 240]）。
          */}
          {presetsWithoutAuto.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setCols(p)}
              className={clsx(s.presetBtn, targetCols === p && s.presetBtnActive)}
            >
              {p}
            </button>
          ))}
          <input
            type="number"
            inputMode="numeric"
            min={COLS_MIN}
            max={COLS_MAX}
            value={colsInput}
            placeholder={t('display.customPlaceholder')}
            onChange={(e) => handleColsInput(e.target.value)}
            onBlur={handleColsBlur}
            className={s.numInput}
            aria-label={t('display.customAriaLabel')}
          />
        </div>
      </section>

      {/* 字间距 */}
      <section className={s.section}>
        <header className={s.sectionHeader}>
          <h3 className={s.sectionTitle}>{t('display.letterSpacingTitle')}</h3>
          <p className={s.sectionHint}>{t('display.letterSpacingHint')}</p>
        </header>

        <div className={s.row}>
          <input
            type="range"
            min={LETTER_SPACING_MIN}
            max={LETTER_SPACING_MAX}
            step={0.5}
            value={letterSpacing}
            onChange={(e) => setLetterSpacing(Number(e.target.value))}
            className={s.slider}
            aria-label={t('display.letterSpacingAriaLabel')}
          />
          <span className={s.valueLabel}>
            {t('display.letterSpacingValue', { val: letterSpacing.toFixed(1) })}
          </span>
          <button
            type="button"
            onClick={() => setLetterSpacing(0)}
            className={s.resetBtn}
            disabled={letterSpacing === 0}
            title={t('display.resetTooltip')}
          >
            {t('common.reset')}
          </button>
        </div>
      </section>
    </div>
  );
}
