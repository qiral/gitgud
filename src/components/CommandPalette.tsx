import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Search } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { fuzzyFilter } from '../lib/fuzzy'
import { shortcutKeys, type Shortcut } from '../lib/shortcuts'
import { useTranslation } from '../i18n'

export interface Command {
  id: string
  label: string
  /** Heading the command is listed under, e.g. "Branch". */
  group: string
  icon?: LucideIcon
  shortcut?: Shortcut
  /** Shown dimmed after the label, e.g. a branch's upstream. */
  detail?: string
  /** More words to search by that aren't shown. */
  keywords?: string
  disabled?: boolean
  /** Runs the command after the palette closes. */
  run?: () => void
  /** Shows what the command would do while it is highlighted; the function
   *  returned takes that back. */
  preview?: () => () => void
  /** Opens a second list instead, e.g. the branches to switch to. */
  page?: { placeholder: string; items: () => Command[] }
}

interface Page {
  title: string | null
  placeholder: string
  items: Command[]
}

interface Props {
  commands: Command[]
  /** Opens straight on this command's page, e.g. from its shortcut. */
  start?: Command
  onClose: () => void
}

const pageOf = (c: Command): Page => ({
  title: c.label,
  placeholder: c.page!.placeholder,
  items: c.page!.items(),
})

export function Keys({ shortcut }: { shortcut: Shortcut }) {
  return (
    <span className="flex shrink-0 gap-0.5">
      {shortcutKeys(shortcut).map((k, i) => (
        <kbd
          key={i}
          className="min-w-5 rounded border border-line bg-bg px-1 text-center font-sans text-xs text-muted"
        >
          {k}
        </kbd>
      ))}
    </span>
  )
}

/** Search every action by name and run it with the keyboard. */
export default function CommandPalette({ commands, start, onClose }: Props) {
  const { t } = useTranslation()
  const [pages, setPages] = useState<Page[]>(() => [
    {
      title: null,
      placeholder: t('commandpalette.type-a-command'),
      items: commands,
    },
    ...(start?.page ? [pageOf(start)] : []),
  ])
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const list = useRef<HTMLUListElement>(null)
  const page = pages[pages.length - 1]

  const shown = useMemo(
    () =>
      fuzzyFilter(query, page.items, (c) =>
        [c.label, c.detail, c.keywords, c.group].filter(Boolean).join(' '),
      ),
    [query, page],
  )

  useEffect(() => setActive(0), [query, page])
  const highlighted = shown[active]
  useEffect(() => highlighted?.preview?.(), [highlighted])
  useEffect(() => {
    list.current
      ?.querySelector(`[data-index="${active}"]`)
      ?.scrollIntoView?.({ block: 'nearest' })
  }, [active])

  function choose(c: Command | undefined) {
    if (!c || c.disabled) return
    if (c.page) {
      setPages((p) => [...p, pageOf(c)])
      setQuery('')
      return
    }
    onClose()
    c.run?.()
  }

  function back() {
    setPages((p) => p.slice(0, -1))
    setQuery('')
  }

  function onKeyDown(e: React.KeyboardEvent) {
    const move = (to: number) => {
      e.preventDefault()
      if (shown.length) setActive((to + shown.length) % shown.length)
    }
    if (e.key === 'ArrowDown') move(active + 1)
    else if (e.key === 'ArrowUp') move(active - 1)
    else if (e.key === 'PageDown') move(Math.min(active + 8, shown.length - 1))
    else if (e.key === 'PageUp') move(Math.max(active - 8, 0))
    else if (e.key === 'Enter') {
      e.preventDefault()
      choose(shown[active])
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      onClose()
    } else if (e.key === 'Backspace' && !query && pages.length > 1) {
      e.preventDefault()
      back()
    }
  }

  // Headings only make sense in the full, unsearched list.
  const grouped = !query.trim() && pages.length === 1

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('commandpalette.command-palette')}
      data-command-palette
      className="fixed inset-0 z-40 flex justify-center bg-black/40 pt-[12vh]"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="flex max-h-[70vh] w-[36rem] max-w-[calc(100vw-2rem)] flex-col self-start overflow-hidden rounded-lg border border-line bg-panel shadow-xl">
        <div className="flex items-center gap-2 border-b border-line px-3 py-2.5">
          {pages.length > 1 ? (
            <button
              onClick={back}
              title={t('commandpalette.back')}
              className="flex shrink-0 items-center gap-1 rounded bg-hover px-1.5 py-0.5 text-xs text-muted hover:text-fg"
            >
              <ChevronLeft className="size-3.5" />
              {page.title}
            </button>
          ) : (
            <Search className="size-4 shrink-0 text-muted" />
          )}
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={page.placeholder}
            aria-label={page.placeholder}
            role="combobox"
            aria-expanded
            aria-controls="palette-list"
            aria-activedescendant={
              shown[active] ? `palette-${active}` : undefined
            }
            className="min-w-0 flex-1 bg-transparent outline-none"
          />
        </div>
        <ul
          ref={list}
          id="palette-list"
          role="listbox"
          className="min-h-0 flex-1 overflow-auto py-1"
        >
          {shown.length === 0 && (
            <li className="px-3 py-2 text-muted">
              {t('commandpalette.nothing-matches')}
            </li>
          )}
          {shown.map((c, i) => (
            <li key={c.id}>
              {grouped && c.group !== shown[i - 1]?.group && (
                <div className="px-3 pt-2 pb-1 text-xs text-muted">
                  {c.group}
                </div>
              )}
              <div
                id={`palette-${i}`}
                data-index={i}
                role="option"
                aria-selected={i === active}
                aria-disabled={c.disabled}
                onMouseMove={() => setActive(i)}
                onClick={() => choose(c)}
                className={`flex cursor-default items-center gap-2 px-3 py-1.5 ${
                  i === active ? 'bg-hover' : ''
                } ${c.disabled ? 'opacity-40' : ''}`}
              >
                {c.icon ? (
                  <c.icon className="size-4 shrink-0 text-muted" />
                ) : (
                  <span className="size-4 shrink-0" />
                )}
                <span className="truncate">{c.label}</span>
                {c.detail && (
                  <span className="truncate text-xs text-muted">
                    {c.detail}
                  </span>
                )}
                <span className="flex-1" />
                {c.shortcut && <Keys shortcut={c.shortcut} />}
                {c.page && <ChevronRight className="size-4 text-muted" />}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
