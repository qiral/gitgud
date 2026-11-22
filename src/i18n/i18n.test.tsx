import { act, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  ENGLISH,
  I18nProvider,
  AVAILABLE,
  LANGUAGES,
  LOCALE_MESSAGES,
  detectLocale,
  getLocale,
  matchLocale,
  translate,
  translatePlural,
  useTranslation,
} from './index'
import en from './locales/en'

describe('translate', () => {
  it('looks the key up in English', () => {
    expect(translate(null, 'toolbar.language')).toBe('Language')
  })

  it('interpolates {placeholders}', () => {
    expect(translate(null, 'app.update-to', { version: '1.2.3' })).toBe(
      'Update to 1.2.3',
    )
  })

  it('uses the active language when it has the key', () => {
    expect(
      translate({ 'toolbar.language': 'Sprache' }, 'toolbar.language'),
    ).toBe('Sprache')
  })

  it('falls back to English when the active language lacks the key', () => {
    expect(
      translate(
        { 'app.open-repository': 'Abrir repositório' },
        'app.clone-repository',
      ),
    ).toBe('Clone repository')
  })

  it('falls back to the key itself when even English lacks it', () => {
    expect(translate(null, 'no.such.key')).toBe('no.such.key')
    expect(translate(null, 'no.such.key', { a: 1 })).toBe('no.such.key')
  })

  it('leaves unknown placeholders as-is', () => {
    expect(translate(null, 'app.update-to')).toBe('Update to {version}')
  })
})

describe('translatePlural', () => {
  it('picks the form via Intl.PluralRules and interpolates {count}', () => {
    expect(translatePlural(null, ENGLISH, 'historypanel.commits', 1)).toBe(
      '1 commit',
    )
    expect(translatePlural(null, ENGLISH, 'historypanel.commits', 5)).toBe(
      '5 commits',
    )
  })

  it('honours other locales’ plural rules and their messages', () => {
    const de = {
      'files.one': '{count} Datei',
      'files.other': '{count} Dateien',
    }
    expect(translatePlural(de, 'de', 'files', 1)).toBe('1 Datei')
    expect(translatePlural(de, 'de', 'files', 3)).toBe('3 Dateien')
    // No German file: the English forms are used with German rules.
    expect(translatePlural(null, 'de', 'historypanel.commits', 1)).toBe(
      '1 commit',
    )
  })
})

describe('matchLocale', () => {
  it('maps OS tags onto supported languages', () => {
    expect(matchLocale('de')).toBe('de')
    expect(matchLocale('de-AT')).toBe('de')
    expect(matchLocale('fr_FR')).toBe('fr')
    expect(matchLocale('zh-Hans-CN')).toBe('zh-CN')
    expect(matchLocale('en-US')).toBe('en')
  })

  it('returns null for unsupported languages', () => {
    expect(matchLocale('pt-BR')).toBeNull()
    expect(matchLocale('')).toBeNull()
    expect(matchLocale(undefined)).toBeNull()
  })
})

describe('detectLocale', () => {
  it('defaults to the OS language', () => {
    // jsdom's navigator.language is en-US.
    expect(detectLocale()).toBe('en')
  })

  it('prefers the stored choice, normalized', () => {
    localStorage.setItem('gitgud.locale', 'en-GB')
    expect(detectLocale()).toBe('en')
    localStorage.setItem('gitgud.locale', 'xx')
    expect(detectLocale()).toBe('en')
  })

  it('skips languages that have no locale file yet', () => {
    const missing = LANGUAGES.find((l) => l.messages === null)
    if (!missing) return
    localStorage.setItem('gitgud.locale', missing.code)
    expect(detectLocale()).toBe('en')
  })
})

describe('locale files', () => {
  const files = Object.keys(LOCALE_MESSAGES)

  it('has English as the source of truth', () => {
    expect(files).toContain(`./locales/${ENGLISH}.ts`)
    expect(Object.keys(en).length).toBeGreaterThan(100)
  })

  it('fails when a language file has keys English does not have', () => {
    for (const path of files) {
      const code = path.replace('./locales/', '').replace('.ts', '')
      for (const key of Object.keys(LOCALE_MESSAGES[path].default)) {
        expect(
          en,
          `${code}.ts has key "${key}" that en.ts does not have`,
        ).toHaveProperty(key)
      }
    }
  })

  it('keeps the {placeholders} of English in every translation', () => {
    const names = (s: string) =>
      [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()
    const base = (k: string) =>
      k.replace(/\.(zero|one|two|few|many|other)$/, '')
    for (const path of files) {
      for (const [key, text] of Object.entries(LOCALE_MESSAGES[path].default)) {
        const english = en[key] ?? en[`${base(key)}.other`]
        if (english === undefined) continue
        // A plural form may leave the number out, like French "votre commit".
        const expected = names(english).filter(
          (n) => n !== 'count' || key === base(key) || text.includes('{count}'),
        )
        expect(names(text), `${path} ${key}`).toEqual(expected)
      }
    }
  })

  it('shows every language by its own name in the picker', () => {
    for (const path of files) {
      const code = path.replace('./locales/', '').replace('.ts', '')
      const lang = LANGUAGES.find((l) => l.code === code)
      expect(lang, `no picker entry for ${code}`).toBeTruthy()
      expect(lang!.name).not.toBe(code)
    }
    // The planned languages from the tracking issue are all listed.
    for (const code of [
      'tr',
      'az',
      'de',
      'fr',
      'it',
      'es',
      'ja',
      'zh-CN',
      'ko',
    ])
      expect(LANGUAGES.some((l) => l.code === code)).toBe(true)
  })
})

function Probe() {
  const { locale, setLocale, t } = useTranslation()
  return (
    <div>
      <span data-testid="locale">{locale}</span>
      <span data-testid="text">{t('toolbar.language')}</span>
      <button onClick={() => setLocale('de')}>de</button>
      <button onClick={() => setLocale('en')}>en</button>
    </div>
  )
}

describe('the language picker', () => {
  it('only offers languages that have a locale file', () => {
    expect(AVAILABLE.map((l) => l.code)).toContain(ENGLISH)
    for (const l of AVAILABLE) expect(l.messages).not.toBeNull()
  })
})

describe('I18nProvider', () => {
  it('switches the language without a restart', () => {
    localStorage.setItem('gitgud.locale', 'en')
    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    )
    expect(screen.getByTestId('locale').textContent).toBe('en')
    expect(screen.getByTestId('text').textContent).toBe('Language')
    expect(document.documentElement.lang).toBe('en')

    act(() => screen.getByText('de').click())

    // German has no message file yet, so text falls back to English, but the
    // active locale — and <html lang> — switch immediately.
    expect(screen.getByTestId('locale').textContent).toBe('de')
    expect(screen.getByTestId('text').textContent).toBe('Language')
    expect(document.documentElement.lang).toBe('de')
    expect(getLocale()).toBe('de')
    expect(localStorage.getItem('gitgud.locale')).toBe('de')

    act(() => screen.getByText('en').click())
    expect(screen.getByTestId('locale').textContent).toBe('en')
  })
})
