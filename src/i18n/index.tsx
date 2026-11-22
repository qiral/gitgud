import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type { Messages, Vars } from './types'

/**
 * Tiny dependency-free i18n groundwork. English (`locales/en.ts`) is the source
 * of truth; every other locale file in `locales/` is optional and any key it
 * lacks falls back to English, so languages can land one issue at a time.
 * See "Adding a language" in README.md.
 */

// Every locale file in ./locales, keyed by path ('./locales/en.ts'). Exported
// so the parity test can check each file against English.
export const LOCALE_MESSAGES = import.meta.glob<{ default: Messages }>(
  './locales/*.ts',
  { eager: true },
)
const localeModules = LOCALE_MESSAGES

export const ENGLISH = 'en'

const enMessages: Messages = localeModules[`./locales/${ENGLISH}.ts`].default

/**
 * Each language by its own name, shown in the language picker. A locale file
 * without an entry here (or a name without a file) fails the parity test in
 * i18n.test.tsx.
 */
const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English',
  az: 'Azərbaycanca',
  de: 'Deutsch',
  es: 'Español',
  fr: 'Français',
  it: 'Italiano',
  ja: '日本語',
  ko: '한국어',
  tr: 'Türkçe',
  'zh-CN': '简体中文',
}

export interface LanguageInfo {
  code: string
  /** Native name, e.g. "Deutsch" — never translated. */
  name: string
  /** null while the language has no locale file yet; falls back to English. */
  messages: Messages | null
}

export const LANGUAGES: LanguageInfo[] = Object.entries(LANGUAGE_NAMES).map(
  ([code, name]) => ({
    code,
    name,
    messages: localeModules[`./locales/${code}.ts`]?.default ?? null,
  }),
)

const STORAGE_KEY = 'gitgud.locale'

/** Map an OS language tag onto a supported language: 'de-AT' -> 'de'. */
export function matchLocale(tag: string | null | undefined): string | null {
  if (!tag) return null
  const norm = tag.replace('_', '-')
  if (LANGUAGE_NAMES[norm]) return norm
  const base = norm.split('-')[0]
  if (LANGUAGE_NAMES[base]) return base
  // zh-Hans-* and zh-CN are Simplified; Traditional falls back to English.
  if (base === 'zh') return 'zh-CN'
  return null
}

/** The stored choice, else the OS language, else English. */
export function detectLocale(): string {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    const matched = matchLocale(stored)
    if (matched) return matched
  } catch {
    // No localStorage (tests, privacy modes): fall through to the OS.
  }
  if (typeof navigator !== 'undefined') {
    for (const tag of navigator.languages ?? [navigator.language]) {
      const matched = matchLocale(tag)
      if (matched) return matched
    }
  }
  return ENGLISH
}

// Module-level locale so non-React code (src/lib/time.ts) formats with the
// active language too. The provider keeps it in sync.
let currentLocale = detectLocale()

export function getLocale(): string {
  return currentLocale
}

/** Persist and activate a language; takes effect without a restart. */
export function setLocale(code: string): void {
  currentLocale = LANGUAGES.some((l) => l.code === code) ? code : ENGLISH
  try {
    localStorage.setItem(STORAGE_KEY, currentLocale)
  } catch {
    // Storage full or blocked: the in-memory choice still applies.
  }
}

/** Replace {name} placeholders; unknown placeholders are left as-is. */
function interpolate(text: string, vars?: Vars): string {
  if (!vars) return text
  return text.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in vars ? String(vars[name] ?? '') : whole,
  )
}

/** Look up a key in one language's messages, falling back to English, then to the key itself. */
export function translate(
  messages: Messages | null,
  key: string,
  vars?: Vars,
): string {
  return interpolate(messages?.[key] ?? enMessages[key] ?? key, vars)
}

const pluralCache = new Map<string, Intl.PluralRules>()

function pluralRules(locale: string): Intl.PluralRules {
  let rules = pluralCache.get(locale)
  if (!rules) {
    rules = new Intl.PluralRules(locale)
    pluralCache.set(locale, rules)
  }
  return rules
}

/**
 * Plural form of a key: messages hold `key.one` / `key.other` (per
 * Intl.PluralRules of the active locale), with `{count}` interpolated.
 */
export function translatePlural(
  messages: Messages | null,
  locale: string,
  key: string,
  count: number,
  vars?: Vars,
): string {
  const form = pluralRules(locale).select(count)
  const raw =
    messages?.[`${key}.${form}`] ??
    messages?.[`${key}.other`] ??
    messages?.[key] ??
    enMessages[`${key}.${form}`] ??
    enMessages[`${key}.other`] ??
    enMessages[key] ??
    key
  return interpolate(raw, { count, ...vars })
}

export type Translate = (key: string, vars?: Vars) => string
export type TranslatePlural = (
  key: string,
  count: number,
  vars?: Vars,
) => string

export interface I18nValue {
  locale: string
  setLocale: (code: string) => void
  t: Translate
  tp: TranslatePlural
  languages: LanguageInfo[]
}

const I18nContext = createContext<I18nValue | null>(null)

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState(() => {
    const detected = detectLocale()
    currentLocale = detected
    return detected
  })

  // Keep the module-level locale (used by src/lib/time.ts) and <html lang> in
  // sync, and re-render the whole tree on a language change.
  useEffect(() => {
    currentLocale = locale
    document.documentElement.lang = locale
  }, [locale])

  const value = useMemo<I18nValue>(() => {
    const messages = LANGUAGES.find((l) => l.code === locale)?.messages ?? null
    return {
      locale,
      setLocale: (code: string) => {
        setLocale(code)
        setLocaleState(getLocale())
      },
      t: (key, vars) => translate(messages, key, vars),
      tp: (key, count, vars) =>
        translatePlural(messages, locale, key, count, vars),
      languages: LANGUAGES,
    }
  }, [locale])

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

// Without a provider (unit tests render components directly) everything still
// works in the current locale, just without re-rendering on a switch.
const fallback: I18nValue = {
  get locale() {
    return currentLocale
  },
  setLocale,
  t: (key, vars) =>
    translate(
      LANGUAGES.find((l) => l.code === currentLocale)?.messages ?? null,
      key,
      vars,
    ),
  tp: (key, count, vars) =>
    translatePlural(
      LANGUAGES.find((l) => l.code === currentLocale)?.messages ?? null,
      currentLocale,
      key,
      count,
      vars,
    ),
  languages: LANGUAGES,
}

export function useTranslation(): I18nValue {
  return useContext(I18nContext) ?? fallback
}
