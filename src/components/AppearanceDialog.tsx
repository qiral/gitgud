import { useEffect, useRef, useState } from 'react'
import {
  Check,
  Minus,
  Moon,
  Plus,
  RotateCcw,
  Search,
  Shuffle,
  Sun,
  SunMoon,
} from 'lucide-react'
import Dialog from './Dialog'
import {
  ACCENTS,
  MAX_CODE_SIZE,
  MIN_CODE_SIZE,
  resolveTheme,
  setAppearance,
  useAppearance,
  type Accent,
  type Appearance,
} from '../lib/appearance'
import { THEMES, type ThemeInfo } from '../lib/themes'
import { SYNTAX, type SyntaxKind } from '../lib/syntax'
import { fuzzyFilter } from '../lib/fuzzy'
import { useTranslation } from '../i18n'

type Filter = 'all' | 'light' | 'dark'

/** While following the system, a theme is picked for its own time of day. */
function pick(theme: ThemeInfo, a: Appearance) {
  if (a.theme !== 'system') setAppearance({ theme: theme.id })
  else if (theme.dark) setAppearance({ darkTheme: theme.id })
  else setAppearance({ lightTheme: theme.id })
}

function isPicked(theme: ThemeInfo, a: Appearance) {
  if (a.theme !== 'system') return a.theme === theme.id
  return theme.id === (theme.dark ? a.darkTheme : a.lightTheme)
}

/** Theme, accent, diff colors and code text. Changes apply right away. */
export default function AppearanceDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const a = useAppearance()
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const active = resolveTheme(a)
  const syn = (kind: SyntaxKind) => (a.syntax ? SYNTAX[kind] : '')
  const system = a.theme === 'system'
  const list = useRef<HTMLDivElement>(null)

  // Start at the theme in use.
  useEffect(() => {
    list.current
      ?.querySelector(`[data-card="${active.id}"]`)
      ?.scrollIntoView?.({ block: 'center' })
  }, [])

  const shown = fuzzyFilter(
    query,
    THEMES.filter((th) => filter === 'all' || th.dark === (filter === 'dark')),
    (th) => th.label,
  )
  // Searching mixes the two, best match first.
  const groups = query.trim()
    ? [{ id: 'found', label: null, list: shown }]
    : [
        {
          id: 'light',
          label: t('toolbar.light'),
          list: shown.filter((th) => !th.dark),
        },
        {
          id: 'dark',
          label: t('toolbar.dark'),
          list: shown.filter((th) => th.dark),
        },
      ].filter((g) => g.list.length > 0)

  function shuffle() {
    // Following the system, only the side on screen would show a change.
    const others = THEMES.filter(
      (th) => th.id !== active.id && (!system || th.dark === active.dark),
    )
    pick(others[Math.floor(Math.random() * others.length)], a)
  }

  return (
    <Dialog title={t('appearance.title')} onClose={onClose} size="xl">
      <div className="flex h-[min(34rem,calc(100vh-9rem))] gap-5">
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="flex items-center gap-2">
            <label className="flex min-w-0 flex-1 items-center gap-2 rounded-md border border-line bg-bg px-2 py-1.5 focus-within:border-accent">
              <Search className="size-4 shrink-0 text-muted" />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('appearance.search')}
                aria-label={t('appearance.search')}
                className="min-w-0 flex-1 bg-transparent outline-none"
              />
            </label>
            <Segments
              label={t('toolbar.theme')}
              value={filter}
              onChange={setFilter}
              options={[
                { value: 'all', label: t('appearance.all') },
                { value: 'light', label: t('toolbar.light') },
                { value: 'dark', label: t('toolbar.dark') },
              ]}
            />
            <button
              onClick={shuffle}
              title={t('appearance.shuffle')}
              aria-label={t('appearance.shuffle')}
              className="rounded-md border border-line p-2 text-muted hover:bg-hover hover:text-fg"
            >
              <Shuffle className="size-4" />
            </button>
          </div>
          <div
            ref={list}
            className="min-h-0 flex-1 overflow-y-auto pr-2 [scrollbar-gutter:stable]"
          >
            {groups.map((g) => (
              <section key={g.id} className="mb-4">
                {g.label && (
                  <h3 className="mb-2 text-xs font-medium text-muted">
                    {g.label}
                  </h3>
                )}
                <div className="grid grid-cols-2 gap-3 p-0.5 lg:grid-cols-3">
                  {g.list.map((th) => (
                    <ThemeCard
                      key={th.id}
                      theme={th}
                      picked={isPicked(th, a)}
                      system={system}
                      onPick={() => pick(th, a)}
                    />
                  ))}
                </div>
              </section>
            ))}
            {shown.length === 0 && (
              <p className="p-6 text-center text-muted">
                {t('appearance.no-themes')}
              </p>
            )}
          </div>
        </div>

        <div className="w-66 shrink-0 space-y-5 overflow-y-auto border-l border-line pr-3 pl-5 [scrollbar-gutter:stable]">
          <section>
            <label className="flex items-center gap-2 py-1">
              <SunMoon className="size-4 text-muted" />
              <span className="flex-1 font-medium">
                {t('toolbar.match-system')}
              </span>
              <input
                type="checkbox"
                checked={system}
                onChange={(e) =>
                  setAppearance(
                    e.target.checked
                      ? {
                          theme: 'system',
                          // Keep what is on screen for its time of day.
                          [active.dark ? 'darkTheme' : 'lightTheme']: active.id,
                        }
                      : { theme: active.id },
                  )
                }
              />
            </label>
            <p className="mt-1 text-xs text-muted">
              {t('appearance.match-system-hint')}
            </p>
          </section>

          <section>
            <h3 className="mb-2 font-medium">{t('appearance.accent')}</h3>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setAppearance({ accent: null })}
                aria-pressed={a.accent === null}
                className={`rounded-full border px-2 text-xs leading-5 ${
                  a.accent === null
                    ? 'border-accent text-accent'
                    : 'border-line text-muted hover:text-fg'
                }`}
              >
                {t('appearance.from-theme')}
              </button>
              {(Object.keys(ACCENTS) as Accent[]).map((name) => (
                <button
                  key={name}
                  onClick={() => setAppearance({ accent: name })}
                  title={t(`appearance.accent-${name}`)}
                  aria-label={t(`appearance.accent-${name}`)}
                  aria-pressed={a.accent === name}
                  style={{ background: ACCENTS[name][active.dark ? 1 : 0] }}
                  className="flex size-[22px] items-center justify-center rounded-full hover:opacity-80"
                >
                  {a.accent === name && (
                    <Check className="size-3.5 text-on-accent" />
                  )}
                </button>
              ))}
            </div>
          </section>

          <section>
            <h3 className="mb-2 font-medium">{t('appearance.diff-colors')}</h3>
            <Segments
              label={t('appearance.diff-colors')}
              value={a.diffColors}
              onChange={(diffColors) => setAppearance({ diffColors })}
              options={[
                { value: 'default', label: t('appearance.from-theme') },
                { value: 'blue-orange', label: t('appearance.blue-orange') },
              ]}
            />
            <p className="mt-1 text-xs text-muted">
              {t('appearance.diff-colors-hint')}
            </p>
          </section>

          <section>
            <h3 className="mb-2 font-medium">{t('appearance.code')}</h3>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-muted">{t('appearance.size')}</span>
              <span className="flex items-center gap-2">
                <StepButton
                  label={t('appearance.smaller')}
                  disabled={a.codeSize <= MIN_CODE_SIZE}
                  onClick={() => setAppearance({ codeSize: a.codeSize - 1 })}
                >
                  <Minus className="size-3.5" />
                </StepButton>
                <span className="w-5 text-center tabular-nums">
                  {a.codeSize}
                </span>
                <StepButton
                  label={t('appearance.larger')}
                  disabled={a.codeSize >= MAX_CODE_SIZE}
                  onClick={() => setAppearance({ codeSize: a.codeSize + 1 })}
                >
                  <Plus className="size-3.5" />
                </StepButton>
              </span>
            </div>
            <input
              value={a.codeFont}
              onChange={(e) => setAppearance({ codeFont: e.target.value })}
              placeholder={t('appearance.font-placeholder')}
              aria-label={t('appearance.font')}
              spellCheck={false}
              className="w-full rounded-md border border-line bg-bg px-2 py-1.5 outline-none focus:border-accent"
            />
            <label className="mt-2 flex items-center gap-2 py-1.5">
              <span className="flex-1 text-muted">
                {t('appearance.syntax')}
              </span>
              <input
                type="checkbox"
                checked={a.syntax}
                onChange={(e) => setAppearance({ syntax: e.target.checked })}
              />
            </label>
            <div
              className="code-text mt-2 overflow-hidden rounded-md border border-line bg-bg whitespace-pre"
              aria-hidden
            >
              <div className="px-2">
                <span className={syn('keyword')}>const</span> git = {'{'}
              </div>
              <div className="bg-removed-bg px-2">
                <span className="text-removed">-</span>{' '}
                <span className={syn('variable')}>good</span>:{' '}
                <span className={syn('number')}>false</span>
              </div>
              <div className="bg-added-bg px-2">
                <span className="text-added">+</span>{' '}
                <span className={syn('variable')}>good</span>:{' '}
                <span className={syn('number')}>true</span>
              </div>
              <div className="px-2">{'}'}</div>
            </div>
          </section>

          <button
            onClick={() =>
              setAppearance({
                theme: 'system',
                lightTheme: 'light',
                darkTheme: 'dark',
                accent: null,
                diffColors: 'default',
                codeSize: 12,
                codeFont: '',
                syntax: true,
              })
            }
            className="flex items-center gap-2 text-xs text-muted hover:text-fg"
          >
            <RotateCcw className="size-3.5" />
            {t('appearance.reset')}
          </button>
        </div>
      </div>
    </Dialog>
  )
}

/** A small drawing of the app in the theme's own colors, which it gets by
 *  setting data-theme on itself. */
function ThemeCard({
  theme,
  picked,
  system,
  onPick,
}: {
  theme: ThemeInfo
  picked: boolean
  system: boolean
  onPick: () => void
}) {
  const Badge = !system ? Check : theme.dark ? Moon : Sun
  return (
    <button
      onClick={onPick}
      data-card={theme.id}
      aria-pressed={picked}
      className={`relative overflow-hidden rounded-lg border text-left outline-offset-2 focus-visible:outline-2 focus-visible:outline-accent ${
        picked
          ? 'border-accent ring-1 ring-accent'
          : 'border-line hover:border-muted'
      }`}
    >
      <span
        data-theme={theme.id}
        className="flex h-20 flex-col bg-bg"
        aria-hidden
      >
        <span className="flex h-4 items-center gap-1 border-b border-line bg-panel px-1.5">
          <span className="h-1 w-6 rounded-full bg-fg" />
          <span className="h-1 w-4 rounded-full bg-muted" />
          <span className="flex-1" />
          <span className="h-2 w-5 rounded-sm bg-accent" />
        </span>
        <span className="flex min-h-0 flex-1">
          <span className="flex w-2/5 flex-col gap-1 border-r border-line bg-panel py-1.5">
            <span className="mx-1 flex h-3 items-center gap-1 rounded-sm bg-hover px-1">
              <span className="size-1.5 rounded-full bg-modified" />
              <span className="h-1 w-3/5 rounded-full bg-fg" />
            </span>
            <span className="mx-1 flex h-3 items-center gap-1 px-1">
              <span className="size-1.5 rounded-full bg-added" />
              <span className="h-1 w-2/5 rounded-full bg-muted" />
            </span>
            <span className="mx-1 flex h-3 items-center gap-1 px-1">
              <span className="size-1.5 rounded-full bg-removed" />
              <span className="h-1 w-1/2 rounded-full bg-muted" />
            </span>
          </span>
          <span className="flex flex-1 flex-col justify-center">
            <span className="flex h-3 items-center px-1.5">
              <span className="h-1 w-3/4 rounded-full bg-muted" />
            </span>
            <span className="flex h-3 items-center bg-removed-bg px-1.5">
              <span className="h-1 w-1/2 rounded-full bg-removed" />
            </span>
            <span className="flex h-3 items-center bg-added-bg px-1.5">
              <span className="h-1 w-2/3 rounded-full bg-added" />
            </span>
            <span className="flex h-3 items-center px-1.5">
              <span className="h-1 w-2/5 rounded-full bg-fg" />
            </span>
          </span>
        </span>
      </span>
      <span className="flex items-center gap-1 border-t border-line bg-panel px-2 py-1.5 text-xs">
        <span className="min-w-0 flex-1 truncate">{theme.label}</span>
        {picked && <Badge className="size-3.5 shrink-0 text-accent" />}
      </span>
    </button>
  )
}

function Segments<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: { value: T; label: string }[]
  onChange: (value: T) => void
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="flex shrink-0 rounded-md border border-line bg-bg p-0.5"
    >
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          aria-pressed={o.value === value}
          className={`flex-1 rounded px-2 py-1 text-xs ${
            o.value === value
              ? 'bg-hover font-medium text-fg'
              : 'text-muted hover:text-fg'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

function StepButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string
  disabled: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className="flex size-7 items-center justify-center rounded border border-line text-muted hover:bg-hover hover:text-fg disabled:opacity-40"
    >
      {children}
    </button>
  )
}
