/**
 * DisplaySettings
 *
 * 终端显示偏好:字号上下限 + 最大列数(自适应字号) + 字间距 + 调色板。
 *
 * 字号上下限:
 *  - fontSizeMin / fontSizeMax 都在 [FONT_SIZE_FLOOR=6, FONT_SIZE_CEIL=32]
 *  - 任意写入后 normalize 会 swap 保证 min ≤ max
 *
 * 最大列数:
 *  - 0 = 关闭自适应(用默认字号 13px)
 *  - 80/100/120 三个预设按钮一键切换
 *  - 自定义输入:[40, 240]
 *  - clamp 到当前 fontSizeMin/fontSizeMax,所以"我设了 120 列实际只渲染 80 列"
 *    可能是字号下限太大;调小 fontSizeMin 即可
 *
 * 字间距:
 *  - 范围 [-2, 4],0 = 默认
 *  - 滑块 + 数值同步
 *
 * 即时生效:用户调一项 → setDraft → useTerminal 收到 effect 立即重应用
 */

import { useState, useEffect, useMemo, useRef, type JSX } from 'react';
import { IconChevronDown, IconCheck } from '@tabler/icons-react';
import {
  DEFAULT_DISPLAY,
  FONT_SIZE_FLOOR,
  FONT_SIZE_CEIL,
  LETTER_SPACING_MIN,
  LETTER_SPACING_MAX,
  type DisplayPrefs,
  type TerminalThemeName,
} from 'auvezy-terminal-remote-shared';
import clsx from 'clsx';
import { getDefaultXtermFontSize } from '../../config/constants.js';
import { useT } from '../../i18n/i18n-context.js';
import { THEME_LIST, resolveTheme } from '../../themes/terminal-themes.js';
import { BoolToggleRow } from './BoolToggleRow.js';
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
 * 与 useTerminal 中 computeFontPrefs 同算法。
 *
 * 参考宽度必须是稳定值(不随预览容器抖动):sheet body 出现滚动条会让预览容器
 * 宽度抖几像素,ResizeObserver 反推出不同字号 → "调列数下面就跳字号"的视觉 bug。
 * 用 window.innerWidth 接近真实终端宽度,只在窗口 resize 时变。
 */
type PreviewPrefs = Pick<
  DisplayPrefs,
  'maxCols' | 'letterSpacing' | 'fontSizeMin' | 'fontSizeMax'
>;

function computePreviewFontSize(referenceWidth: number, prefs: PreviewPrefs): number {
  const maxCols = prefs.maxCols ?? 0;
  const ls = prefs.letterSpacing ?? 0;
  const fsMin = prefs.fontSizeMin ?? DEFAULT_DISPLAY.fontSizeMin;
  const fsMax = prefs.fontSizeMax ?? DEFAULT_DISPLAY.fontSizeMax;
  if (!maxCols || maxCols <= 0 || referenceWidth <= 0) return getDefaultXtermFontSize();
  const raw = (referenceWidth / maxCols - ls) / CHAR_WIDTH_RATIO;
  return Math.max(fsMin, Math.min(fsMax, Math.floor(raw)));
}

export interface DisplaySettingsProps {
  value: DisplayPrefs | undefined;
  onChange: (next: DisplayPrefs) => void;
}

// 输入框接受的范围（可超出预设）
const COLS_MIN = 40;
const COLS_MAX = 240;

/**
 * 根据当前屏幕宽度 + 用户字号上下限算"有意义的列数预设"
 *
 * 同一字号下相邻 cols 视觉无差别——`fontSize = floor(W / cols / 0.6)` clamp 到
 * [fontSizeMin, fontSizeMax]。所以对每个可能的 fontSize 反推一个 cols 即可覆盖
 * 所有视觉档位。用户调小 fontSizeMin → 预设会出现更密集的大列数选项。
 *
 * 算法:fontSize 从 fontSizeMax → fontSizeMin 遍历,每个算
 * `cols = floor(W / fontSize / 0.6)`,落在 [COLS_MIN, COLS_MAX] 内的去重收集。
 * 结果按升序返回。
 */
function computeMeaningfulPresets(
  width: number,
  prefs: Pick<DisplayPrefs, 'fontSizeMin' | 'fontSizeMax'>,
): number[] {
  if (width <= 0) return [80, 100, 120, 220];
  const fsMin = prefs.fontSizeMin ?? DEFAULT_DISPLAY.fontSizeMin;
  const fsMax = prefs.fontSizeMax ?? DEFAULT_DISPLAY.fontSizeMax;
  const set = new Set<number>();
  for (let fs = fsMax; fs >= fsMin; fs--) {
    const cols = Math.floor(width / fs / CHAR_WIDTH_RATIO);
    if (cols >= COLS_MIN && cols <= COLS_MAX) set.add(cols);
  }
  return Array.from(set).sort((a, b) => a - b);
}

export function DisplaySettings({ value, onChange }: DisplaySettingsProps): JSX.Element {
  const t = useT();
  const maxCols = value?.maxCols ?? DEFAULT_DISPLAY.maxCols;
  const fontSizeMin = value?.fontSizeMin ?? DEFAULT_DISPLAY.fontSizeMin;
  const fontSizeMax = value?.fontSizeMax ?? DEFAULT_DISPLAY.fontSizeMax;
  const letterSpacing = value?.letterSpacing ?? DEFAULT_DISPLAY.letterSpacing;
  const theme = value?.theme ?? DEFAULT_DISPLAY.theme;
  const markdownPreview = value?.markdownPreview ?? DEFAULT_DISPLAY.markdownPreview;
  // 预览也用当前主题色,让用户改主题立即看到效果
  const palette = useMemo(() => resolveTheme(theme), [theme]);

  // 自定义列数输入框:与 maxCols 双向绑定,但允许输入中途为空
  const [colsInput, setColsInput] = useState<string>(maxCols > 0 ? String(maxCols) : '');
  useEffect(() => {
    setColsInput(maxCols > 0 ? String(maxCols) : '');
  }, [maxCols]);

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

  const previewFontSize = computePreviewFontSize(referenceWidth, {
    maxCols,
    letterSpacing,
    fontSizeMin,
    fontSizeMax,
  });

  // 字号上下限变化也要重算(放大下限 → 大列数选项消失)
  const presets = useMemo(
    () => computeMeaningfulPresets(referenceWidth, { fontSizeMin, fontSizeMax }),
    [referenceWidth, fontSizeMin, fontSizeMax],
  );
  // Auto 模式下用默认字号(移动端 8 / 桌面端 14)反推 cols;从预设里去掉避免重复
  const autoCols = useMemo(() => {
    if (referenceWidth <= 0) return 0;
    return Math.floor(referenceWidth / getDefaultXtermFontSize() / CHAR_WIDTH_RATIO);
  }, [referenceWidth]);
  const presetsWithoutAuto = useMemo(
    () => presets.filter((p) => p !== autoCols),
    [presets, autoCols],
  );

  const setCols = (n: number): void => {
    onChange({ ...value, maxCols: n });
  };

  // 写入超出 [min, max] 时由 normalize 端 swap,这里只做边界 clamp
  const setFontSize = (key: 'fontSizeMin' | 'fontSizeMax', n: number): void => {
    const clamped = Math.max(FONT_SIZE_FLOOR, Math.min(FONT_SIZE_CEIL, n));
    onChange({ ...value, [key]: clamped });
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
      setColsInput(maxCols > 0 ? String(maxCols) : '');
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
              cols: maxCols > 0
                ? t('display.colsModeTarget', { cols: maxCols })
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

      {/* 字号上下限:必须在"最大列数"之前 —— 用户改下限会重算 maxCols 的预设列表 */}
      <section className={s.section}>
        <header className={s.sectionHeader}>
          <h3 className={s.sectionTitle}>{t('display.fontSizeRangeTitle')}</h3>
          <p className={s.sectionHint}>{t('display.fontSizeRangeHint')}</p>
        </header>
        <div className={s.row}>
          <label className={s.numInputLabel}>
            {t('display.fontSizeMinLabel')}
            <input
              type="number"
              inputMode="numeric"
              min={FONT_SIZE_FLOOR}
              max={FONT_SIZE_CEIL}
              value={fontSizeMin}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (Number.isInteger(n)) setFontSize('fontSizeMin', n);
              }}
              className={s.numInput}
              aria-label={t('display.fontSizeMinAriaLabel')}
            />
          </label>
          <label className={s.numInputLabel}>
            {t('display.fontSizeMaxLabel')}
            <input
              type="number"
              inputMode="numeric"
              min={FONT_SIZE_FLOOR}
              max={FONT_SIZE_CEIL}
              value={fontSizeMax}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (Number.isInteger(n)) setFontSize('fontSizeMax', n);
              }}
              className={s.numInput}
              aria-label={t('display.fontSizeMaxAriaLabel')}
            />
          </label>
        </div>
      </section>

      {/* 最大列数 */}
      <section className={s.section}>
        <header className={s.sectionHeader}>
          <h3 className={s.sectionTitle}>{t('display.maxColsTitle')}</h3>
          <p className={s.sectionHint}>{t('display.maxColsHint')}</p>
        </header>

        <div className={s.row}>
          <button
            type="button"
            onClick={() => setCols(0)}
            className={clsx(s.presetBtn, maxCols === 0 && s.presetBtnActive)}
            title={t('display.autoTooltip')}
          >
            {autoCols > 0 ? `${t('display.autoLabel')} · ${autoCols}` : t('display.autoLabel')}
          </button>
          {/*
            预设按钮:根据当前预览宽度 + 字号上下限反推"有意义的列数"——同字号下
            的相邻 cols 视觉无差别,只列出会真实改变 fontSize 的 cols 值。
            过滤掉与 Auto 模式相同的 cols(避免按钮重复)。
            数字输入框接受超出预设的值([40, 240])。
          */}
          {presetsWithoutAuto.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setCols(p)}
              className={clsx(s.presetBtn, maxCols === p && s.presetBtnActive)}
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

      {/* 文件预览 — markdown 可视化 */}
      <BoolToggleRow
        title={t('display.markdownPreviewTitle')}
        hint={t('display.markdownPreviewHint')}
        value={markdownPreview}
        onChange={(next) => onChange({ ...value, markdownPreview: next })}
      />
    </div>
  );
}
