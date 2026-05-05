/**
 * i18n React Context
 *
 * 提供：
 *  - useT()：返回 t(key, vars?) → 翻译后字符串。key 是 Messages 的 dot path
 *    （如 'authPage.title'）。缺 key 返回 key 本身（debug 友好）
 *  - useLocale()：[locale, setLocale]，setLocale 同步写 localStorage
 *
 * 持久化：localStorage key = 'ocr.locale'。读不到 / 不在白名单内 → 用 DEFAULT_LOCALE
 *
 * 默认 en：第一次访问时写入 localStorage，之后用户选了别的语言以用户为准
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type JSX,
  type ReactNode,
} from 'react';
import {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  format,
  getByPath,
  type Locale,
  type Messages,
} from './messages.js';
import { en } from './en.js';
import { zhCN } from './zh-CN.js';

const STORAGE_KEY = 'ocr.locale';

const TABLES: Record<Locale, Messages> = {
  en,
  'zh-CN': zhCN,
};

function isLocale(s: string): s is Locale {
  return SUPPORTED_LOCALES.some((l) => l.code === s);
}

function readStored(): Locale {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v && isLocale(v)) return v;
  } catch {
    /* 隐私模式 */
  }
  return DEFAULT_LOCALE;
}

function writeStored(loc: Locale): void {
  try {
    localStorage.setItem(STORAGE_KEY, loc);
  } catch {
    /* 隐私模式：忽略；下次 load 回到默认 */
  }
}

interface I18nContextValue {
  locale: Locale;
  setLocale: (next: Locale) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }): JSX.Element {
  const [locale, setLocaleState] = useState<Locale>(() => readStored());

  const setLocale = useCallback((next: Locale): void => {
    if (!isLocale(next)) return;
    writeStored(next);
    setLocaleState(next);
  }, []);

  // 同步 <html lang>，让浏览器 / 屏幕阅读器知道当前语言
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const t = useCallback(
    (key: string, vars?: Record<string, string | number>): string => {
      const table = TABLES[locale];
      const value = getByPath(table, key);
      if (typeof value !== 'string') {
        // 缺 key 时尝试 fallback 到 en；都没有就返回 key 本身（开发期可见）
        const fallback = getByPath(en, key);
        if (typeof fallback === 'string') return format(fallback, vars);
        return key;
      }
      return format(value, vars);
    },
    [locale],
  );

  const value = useMemo<I18nContextValue>(
    () => ({ locale, setLocale, t }),
    [locale, setLocale, t],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/** 拿翻译函数 + 当前 locale */
export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n 必须在 I18nProvider 内使用');
  return ctx;
}

/** 仅取 t 函数的便捷 hook */
export function useT(): I18nContextValue['t'] {
  return useI18n().t;
}
