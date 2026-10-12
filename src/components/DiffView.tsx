import { useEffect, useMemo, useState } from 'react'
import { confirm } from '@tauri-apps/plugin-dialog'
import type { LineAction } from '../lib/git'
import { useVirtualRows } from '../lib/virtual'

type LineKind = 'add' | 'remove' | 'context' | 'hunk' | 'meta'

interface Line {
  kind: LineKind
  text: string
  /** Position in diff.split('\n'); the backend identifies lines by it. */
  index: number
  /** Which hunk the line belongs to, -1 before the first one. */
  hunk: number
  oldNo?: number
  newNo?: number
}

const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/

/** Turns unified diff text into lines with old/new line numbers. */
function parse(diff: string): Line[] {
  const lines: Line[] = []
  let oldNo = 0
  let newNo = 0
  let hunk = -1
  let inHunk = false

  diff.split('\n').forEach((text, index) => {
    const base = { index, hunk }
    const match = HUNK.exec(text)
    if (match) {
      oldNo = Number(match[1])
      newNo = Number(match[2])
      inHunk = true
      hunk += 1
      lines.push({ kind: 'hunk', text, index, hunk })
    } else if (text.startsWith('diff --git')) {
      inHunk = false
      lines.push({ ...base, kind: 'meta', text })
    } else if (!inHunk) {
      lines.push({ ...base, kind: 'meta', text })
    } else if (text.startsWith('+')) {
      lines.push({ ...base, kind: 'add', text: text.slice(1), newNo: newNo++ })
    } else if (text.startsWith('-')) {
      lines.push({
        ...base,
        kind: 'remove',
        text: text.slice(1),
        oldNo: oldNo++,
      })
    } else if (text.startsWith('\\')) {
      lines.push({ ...base, kind: 'meta', text })
    } else {
      lines.push({
        ...base,
        kind: 'context',
        text: text.slice(1),
        oldNo: oldNo++,
        newNo: newNo++,
      })
    }
  })

  while (lines.length && lines[lines.length - 1].text === '') lines.pop()
  return lines
}

const isChange = (l: Line) => l.kind === 'add' || l.kind === 'remove'

/** Binary files can only be staged as a whole. */
const BINARY = /^Binary files/m

/** Longer diffs only render the rows on screen. Short ones render fully, so
 *  selecting and copying a whole diff keeps working where it's practical. */
const VIRTUAL_FROM = 1000
/** Matches `leading-5` on the table; hunk buttons fit inside it. */
const ROW_HEIGHT = 20

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

const SIGN: Record<LineKind, string> = {
  add: '+',
  remove: '-',
  context: ' ',
  hunk: '',
  meta: '',
}

interface Props {
  diff: string
  /** Enables selecting lines and hunks of a working tree or staged diff. */
  actions?: {
    staged: boolean
    onApply: (lines: number[], action: LineAction) => Promise<boolean>
  }
}

export default function DiffView({ diff, actions: rawActions }: Props) {
  const lines = useMemo(() => parse(diff), [diff])
  const actions = rawActions && !BINARY.test(diff) ? rawActions : undefined
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [anchor, setAnchor] = useState<number | null>(null)
  const virtual = lines.length >= VIRTUAL_FROM
  const rows = useVirtualRows<HTMLTableElement>(
    lines.length,
    ROW_HEIGHT,
    virtual,
  )
  // Only some rows exist at a time, so they can't size the table's width;
  // reserve room for the longest line up front instead.
  const minWidth = useMemo(
    () => (virtual ? `calc(8.25rem + ${longestLine(lines)}ch)` : undefined),
    [lines, virtual],
  )

  // A new diff means new line numbers; old selections no longer apply.
  useEffect(() => {
    setSelected(new Set())
    setAnchor(null)
  }, [diff])

  if (!diff.trim())
    return (
      <p className="p-6 text-muted">
        No textual changes (binary file or mode change).
      </p>
    )

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
        `Discard ${indexes.length} changed line${indexes.length > 1 ? 's' : ''}? This cannot be undone.`,
        { title: 'Discard lines', kind: 'warning' },
      )
      if (!ok) return
    }
    if (await actions.onApply(indexes, action)) setSelected(new Set())
  }

  const hunkLines = (hunk: number) =>
    lines.filter((l) => l.hunk === hunk && isChange(l)).map((l) => l.index)

  const primary: LineAction = actions?.staged ? 'unstage' : 'stage'
  const count = selected.size

  return (
    <div>
      {actions && count > 0 && (
        <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-line bg-panel px-3 py-2">
          <span className="text-muted">
            {count} line{count > 1 ? 's' : ''} selected
          </span>
          <div className="flex-1" />
          <ActionButton primary onClick={() => apply([...selected], primary)}>
            {actions.staged ? 'Unstage' : 'Stage'} lines
          </ActionButton>
          {!actions.staged && (
            <ActionButton onClick={() => apply([...selected], 'discard')}>
              Discard lines
            </ActionButton>
          )}
          <ActionButton onClick={() => setSelected(new Set())}>
            Clear
          </ActionButton>
        </div>
      )}
      <table
        ref={rows.ref}
        style={{ minWidth }}
        className="w-full border-collapse font-mono text-xs leading-5 select-text"
      >
        <tbody>
          {rows.top > 0 && <tr aria-hidden style={{ height: rows.top }} />}
          {lines.slice(rows.start, rows.end).map((line) => {
            const selectable = actions && isChange(line)
            const isSelected = selected.has(line.index)
            return (
              <tr
                key={line.index}
                className={`group ${ROW[line.kind]} ${
                  isSelected ? 'outline-1 -outline-offset-1 outline-accent' : ''
                }`}
              >
                <td
                  colSpan={line.kind === 'hunk' ? 3 : 1}
                  onClick={(e) => selectable && toggle(line, e.shiftKey)}
                  className={`w-12 pr-2 text-right text-muted/70 select-none ${
                    selectable ? 'cursor-pointer' : ''
                  } ${isSelected ? 'bg-accent/30' : ''}`}
                  title={
                    selectable ? 'Click to select, Shift+click for a range' : ''
                  }
                >
                  {line.kind !== 'hunk' && line.oldNo}
                </td>
                {line.kind !== 'hunk' && (
                  <>
                    <td
                      onClick={(e) => selectable && toggle(line, e.shiftKey)}
                      className={`w-12 border-r border-line pr-2 text-right text-muted/70 select-none ${
                        selectable ? 'cursor-pointer' : ''
                      } ${isSelected ? 'bg-accent/30' : ''}`}
                    >
                      {line.newNo}
                    </td>
                    <td
                      className={`w-5 text-center select-none ${
                        line.kind === 'add'
                          ? 'text-added'
                          : line.kind === 'remove'
                            ? 'text-removed'
                            : ''
                      }`}
                    >
                      {SIGN[line.kind]}
                    </td>
                  </>
                )}
                <td className="pr-4 whitespace-pre">
                  {line.kind === 'hunk' && actions ? (
                    <div className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate">
                        {line.text}
                      </span>
                      <span className="invisible flex gap-1 font-sans group-hover:visible">
                        <ActionButton
                          primary
                          onClick={() => apply(hunkLines(line.hunk), primary)}
                        >
                          {actions.staged ? 'Unstage' : 'Stage'} hunk
                        </ActionButton>
                        {!actions.staged && (
                          <ActionButton
                            onClick={() =>
                              apply(hunkLines(line.hunk), 'discard')
                            }
                          >
                            Discard hunk
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
          })}
          {rows.bottom > 0 && (
            <tr aria-hidden style={{ height: rows.bottom }} />
          )}
        </tbody>
      </table>
    </div>
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
          ? 'bg-accent text-white hover:opacity-90'
          : 'border border-line text-fg hover:bg-hover'
      }`}
    >
      {children}
    </button>
  )
}
