import { useEffect, useMemo, useState } from 'react'
import { confirm } from '@tauri-apps/plugin-dialog'
import { ArrowDownFromLine, ArrowUpFromLine } from 'lucide-react'
import type { LineAction } from '../lib/git'
import { codeRow, useAppearance } from '../lib/appearance'
import { useVirtualRows } from '../lib/virtual'
import { diffTokens, paint, useTokens, SYNTAX, type Token } from '../lib/syntax'
import {
  expandDiff,
  parseDiff,
  splitRows,
  wordHighlights,
  type Expanded,
  type Line,
  type LineKind,
  type Segment,
} from '../lib/diff'
import { setDiffPref, useDiffPrefs } from '../lib/diffPrefs'
import { useTranslation } from '../i18n'

const isChange = (l: Line) => l.kind === 'add' || l.kind === 'remove'

/** Binary files can only be staged as a whole. */
const BINARY = /^Binary files/m

/** Longer diffs only render the rows on screen. Short ones render fully, so
 *  selecting and copying a whole diff keeps working where it's practical. */
const VIRTUAL_FROM = 1000
/** Hidden lines shown with one click. */
const EXPAND_STEP = 20
/** Width of the longest line in characters, tabs counted as 8 like the
 *  browser's default tab-size. */
function longestLine(lines: Line[]) {
  let max = 0
  for (const l of lines) {
    const tabs = l.text.split('\t').length - 1
    max = Math.max(max, l.text.length + tabs * 7)
  }
  return max
}

const ROW: Record<LineKind, string> = {
  add: 'bg-added-bg',
  remove: 'bg-removed-bg',
  context: '',
  hunk: 'bg-panel text-accent',
  meta: 'text-muted',
}

/** The stronger highlight on the words that changed within a line. */
const WORD: Partial<Record<LineKind, string>> = {
  add: 'rounded-sm bg-added/25',
  remove: 'rounded-sm bg-removed/25',
}

const SIGN_COLOR: Partial<Record<LineKind, string>> = {
  add: 'text-added',
  remove: 'text-removed',
}

const SIGN: Record<LineKind, string> = {
  add: '+',
  remove: '-',
  context: ' ',
  hunk: '',
  meta: '',
}

interface Props {
  diff: string
  /** Names the language for syntax highlighting. */
  path?: string
  /** Loads the file as it is after the change, to show hidden lines from it;
   *  null when it can't be shown. Unset to not offer that. */
  loadFile?: () => Promise<string | null>
  /** Enables selecting lines and hunks of a working tree or staged diff. */
  actions?: {
    staged: boolean
    onApply: (lines: number[], action: LineAction) => Promise<boolean>
  }
}

export default function DiffView({
  diff,
  path,
  loadFile,
  actions: rawActions,
}: Props) {
  const { t, tp } = useTranslation()
  const { split, ignoreWhitespace } = useDiffPrefs()
  const parsed = useMemo(() => parseDiff(diff), [diff])
  // Belongs to one diff; another one starts with everything hidden again.
  const [opened, setOpened] = useState<{
    diff: string
    /** Undefined until loaded, null if it can't be shown. */
    file?: string | null
    expanded: Expanded
  }>({ diff, expanded: {} })
  const { file, expanded } =
    opened.diff === diff
      ? opened
      : { file: undefined, expanded: {} as Expanded }
  const lines = useMemo(
    () =>
      loadFile && file !== null
        ? expandDiff(parsed, file ?? null, expanded)
        : parsed,
    [parsed, file, expanded, !loadFile],
  )
  const words = useMemo(() => wordHighlights(lines), [lines])
  const pairs = useMemo(() => (split ? splitRows(lines) : null), [lines, split])
  const binary = BINARY.test(diff)
  // A diff without whitespace changes can't be applied back to the files,
  // so picking lines waits until whitespace is shown again.
  const actions =
    rawActions && !binary && !ignoreWhitespace ? rawActions : undefined
  const stagingPaused = !!rawActions && !binary && ignoreWhitespace
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [anchor, setAnchor] = useState<number | null>(null)
  const rowCount = pairs ? pairs.length : lines.length
  const virtual = rowCount >= VIRTUAL_FROM
  const { codeSize, syntax } = useAppearance()
  const tokens = useTokens(syntax ? path : undefined, lines, diffTokens)
  const rows = useVirtualRows<HTMLTableElement>(
    rowCount,
    codeRow(codeSize),
    virtual,
  )
  // Only some rows exist at a time, so they can't size the table's width;
  // reserve room for the longest line up front instead. Side by side, both
  // halves get that room so long lines scroll instead of squeezing.
  const minWidth = useMemo(() => {
    if (split) return `calc(8.5rem + ${2 * longestLine(lines) + 4}ch)`
    return virtual ? `calc(8.25rem + ${longestLine(lines)}ch)` : undefined
  }, [lines, virtual, split])

  // A new diff means new line numbers; old selections no longer apply.
  useEffect(() => {
    setSelected(new Set())
    setAnchor(null)
  }, [diff])

  if (!diff.trim())
    return ignoreWhitespace ? (
      <div className="flex flex-col items-start gap-2 p-6 text-muted">
        <p>{t('diffview.only-whitespace')}</p>
        <ActionButton onClick={() => setDiffPref('ignoreWhitespace', false)}>
          {t('diffview.show-whitespace')}
        </ActionButton>
      </div>
    ) : (
      <p className="p-6 text-muted">
        No textual changes (binary file or mode change).
      </p>
    )

  async function expand(id: number, side: 'up' | 'down') {
    if (!loadFile) return
    const text = file === undefined ? await loadFile().catch(() => null) : file
    setOpened((o) => {
      const before = o.diff === diff ? o.expanded : {}
      const at = before[id] ?? { up: 0, down: 0 }
      return {
        diff,
        file: text,
        expanded: {
          ...before,
          [id]: { ...at, [side]: at[side] + EXPAND_STEP },
        },
      }
    })
  }

  function toggle(line: Line, shift: boolean) {
    const next = new Set(selected)
    if (shift && anchor !== null) {
      // Select every changed line between the anchor and this one.
      const [from, to] = [anchor, line.index].sort((a, b) => a - b)
      for (const l of lines)
        if (isChange(l) && l.index >= from && l.index <= to) next.add(l.index)
    } else if (next.has(line.index)) {
      next.delete(line.index)
    } else {
      next.add(line.index)
    }
    setSelected(next)
    setAnchor(line.index)
  }

  async function apply(indexes: number[], action: LineAction) {
    if (!actions || indexes.length === 0) return
    if (action === 'discard') {
      const ok = await confirm(
        tp('diffview.discard-lines-body', indexes.length),
        { title: t('diffview.discard-lines'), kind: 'warning' },
      )
      if (!ok) return
    }
    if (await actions.onApply(indexes, action)) setSelected(new Set())
  }

  const hunkLines = (hunk: number) =>
    lines.filter((l) => l.hunk === hunk && isChange(l)).map((l) => l.index)

  const primary: LineAction = actions?.staged ? 'unstage' : 'stage'
  const count = selected.size

  /** A line-number cell; clicking it selects a changed line. */
  const gutter = (
    line: Line | undefined,
    no: number | undefined,
    edge = '',
  ) => {
    const selectable = actions && line && isChange(line)
    const isSelected = line && selected.has(line.index)
    return (
      <td
        onClick={(e) => selectable && toggle(line, e.shiftKey)}
        className={`w-12 pr-2 text-right text-muted/70 select-none ${edge} ${
          selectable ? 'cursor-pointer' : ''
        } ${isSelected ? 'bg-accent/30' : ''}`}
        title={selectable ? t('diffview.select-hint') : ''}
      >
        {no}
      </td>
    )
  }

  const sign = (line: Line) => (
    <td
      className={`w-5 text-center select-none ${SIGN_COLOR[line.kind] ?? ''}`}
    >
      {SIGN[line.kind]}
    </td>
  )

  const text = (line: Line) => {
    const segments = words.get(line.index)
    const code = tokens?.get(line.index)
    return segments || code ? (
      <Code segments={segments} tokens={code} line={line} />
    ) : (
      line.text
    )
  }

  /** A hunk header with its buttons, or (side by side) a meta line, across
   *  the whole row. `span` is the table's column count. */
  const fullRow = (line: Line, span: number) => (
    <tr key={line.index} className={`group ${ROW[line.kind]}`}>
      {/* Skip the line numbers and sign so the text lines up with the code. */}
      <td
        colSpan={span === 4 ? 3 : 2}
        className="relative text-right font-sans select-none"
      >
        {/* Absolute, so the row stays as high as the others. */}
        {line.gap && (line.gap.canDown || line.gap.canUp) && (
          <span className="absolute inset-y-0 right-1 flex items-center">
            {line.gap.canDown && (
              <ExpandButton
                title={t('diffview.expand-down')}
                onClick={() => expand(line.gap!.id, 'down')}
              >
                <ArrowDownFromLine className="size-3.5" />
              </ExpandButton>
            )}
            {line.gap.canUp && (
              <ExpandButton
                title={t('diffview.expand-up')}
                onClick={() => expand(line.gap!.id, 'up')}
              >
                <ArrowUpFromLine className="size-3.5" />
              </ExpandButton>
            )}
          </span>
        )}
      </td>
      <td colSpan={span === 4 ? 1 : span - 2} className="pr-4 whitespace-pre">
        {line.kind === 'hunk' && line.text && actions ? (
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate">{line.text}</span>
            <span className="invisible flex gap-1 font-sans group-hover:visible">
              <ActionButton
                primary
                onClick={() => apply(hunkLines(line.hunk), primary)}
              >
                {actions.staged
                  ? t('diffview.unstage-hunk')
                  : t('diffview.stage-hunk')}
              </ActionButton>
              {!actions.staged && (
                <ActionButton
                  onClick={() => apply(hunkLines(line.hunk), 'discard')}
                >
                  {t('diffview.discard-hunk')}
                </ActionButton>
              )}
            </span>
          </div>
        ) : (
          line.text
        )}
      </td>
    </tr>
  )

  /** One side of a side-by-side row; blank where the other side has more. */
  const half = (line: Line | undefined, side: 'old' | 'new') => {
    if (!line)
      return (
        <>
          <td
            className={`bg-panel ${side === 'new' ? 'border-l border-line' : ''}`}
          />
          <td className="bg-panel" />
          <td className="bg-panel" />
        </>
      )
    const isSelected = selected.has(line.index)
    return (
      <>
        {gutter(
          line,
          side === 'old' ? line.oldNo : line.newNo,
          `${ROW[line.kind]} ${side === 'new' ? 'border-l border-line' : ''}`,
        )}
        <td
          className={`w-5 text-center select-none ${ROW[line.kind]} ${SIGN_COLOR[line.kind] ?? ''}`}
        >
          {SIGN[line.kind]}
        </td>
        <td
          className={`overflow-hidden pr-4 whitespace-pre ${ROW[line.kind]} ${
            isSelected ? 'outline-1 -outline-offset-1 outline-accent' : ''
          }`}
        >
          {text(line)}
        </td>
      </>
    )
  }

  return (
    <div>
      {stagingPaused && (
        <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-line bg-panel px-3 py-2 text-muted">
          <span className="flex-1">{t('diffview.staging-paused')}</span>
          <ActionButton onClick={() => setDiffPref('ignoreWhitespace', false)}>
            {t('diffview.show-whitespace')}
          </ActionButton>
        </div>
      )}
      {actions && count > 0 && (
        <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-line bg-panel px-3 py-2">
          <span className="text-muted">
            {tp('diffview.lines-selected', count)}
          </span>
          <div className="flex-1" />
          <ActionButton primary onClick={() => apply([...selected], primary)}>
            {actions.staged
              ? t('diffview.unstage-lines')
              : t('diffview.stage-lines')}
          </ActionButton>
          {!actions.staged && (
            <ActionButton onClick={() => apply([...selected], 'discard')}>
              {t('diffview.discard-lines')}
            </ActionButton>
          )}
          <ActionButton onClick={() => setSelected(new Set())}>
            {t('diffview.clear')}
          </ActionButton>
        </div>
      )}
      <table
        ref={rows.ref}
        style={{ minWidth }}
        className={`w-full border-collapse code-text select-text ${
          pairs ? 'table-fixed' : ''
        }`}
      >
        {pairs && (
          <colgroup>
            <col className="w-12" />
            <col className="w-5" />
            <col />
            <col className="w-12" />
            <col className="w-5" />
            <col />
          </colgroup>
        )}
        <tbody>
          {rows.top > 0 && <tr aria-hidden style={{ height: rows.top }} />}
          {pairs
            ? pairs.slice(rows.start, rows.end).map((row) =>
                row.kind === 'full' ? (
                  fullRow(row.line, 6)
                ) : (
                  <tr key={row.key}>
                    {half(row.left, 'old')}
                    {half(row.right, 'new')}
                  </tr>
                ),
              )
            : lines.slice(rows.start, rows.end).map((line) => {
                if (line.kind === 'hunk') return fullRow(line, 4)
                const isSelected = selected.has(line.index)
                return (
                  <tr
                    key={line.index}
                    className={`${ROW[line.kind]} ${
                      isSelected
                        ? 'outline-1 -outline-offset-1 outline-accent'
                        : ''
                    }`}
                  >
                    {gutter(line, line.oldNo)}
                    {gutter(line, line.newNo, 'border-r border-line')}
                    {sign(line)}
                    <td className="pr-4 whitespace-pre">{text(line)}</td>
                  </tr>
                )
              })}
          {rows.bottom > 0 && (
            <tr aria-hidden style={{ height: rows.bottom }} />
          )}
        </tbody>
      </table>
    </div>
  )
}

/** A line with its syntax colored and the words that changed marked. */
function Code({
  segments,
  tokens,
  line,
}: {
  segments?: Segment[]
  tokens?: Token[]
  line: Line
}) {
  return (
    <>
      {paint(line.text, tokens, segments).map((s, i) => (
        <span
          key={i}
          className={
            [s.kind && SYNTAX[s.kind], s.changed && WORD[line.kind]]
              .filter(Boolean)
              .join(' ') || undefined
          }
        >
          {s.text}
        </span>
      ))}
    </>
  )
}

function ExpandButton({
  title,
  onClick,
  children,
}: {
  title: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      title={title}
      aria-label={title}
      onClick={onClick}
      className="rounded px-1.5 text-muted hover:bg-hover hover:text-fg"
    >
      {children}
    </button>
  )
}

function ActionButton({
  primary,
  onClick,
  children,
}: {
  primary?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded px-2 py-0.5 text-xs font-medium ${
        primary
          ? 'bg-accent text-on-accent hover:opacity-90'
          : 'border border-line text-fg hover:bg-hover'
      }`}
    >
      {children}
    </button>
  )
}
