import { useEffect, useMemo, useState } from 'react'
import {
  CirclePlus,
  Copy,
  EyeOff,
  GitBranchPlus,
  GitCommitHorizontal,
  Minus,
  PencilLine,
  Plus,
  RotateCcw,
  Tag,
  Trash2,
  Undo2,
  Upload,
  FileClock,
  Search,
  X,
} from 'lucide-react'
import { git, type Commit, type GraphRow, type RefLabel } from '../lib/git'
import { hideLines } from '../lib/lines'
import { relativeTime } from '../lib/time'
import { useVirtualRows } from '../lib/virtual'
import { copyText } from '../lib/copy'
import {
  readFlag,
  readHiddenLines,
  writeFlag,
  writeHiddenLines,
} from '../lib/prefs'
import { useContextMenu, type MenuItem } from './ContextMenu'
import type { Selection } from './RepoView'
import type { CommitActions } from './CommitActions'

/** Narrows History to a search or to one file's commits. */
export type HistoryFilter =
  { kind: 'search'; query: string } | { kind: 'file'; path: string }

interface Props {
  /** Remembers hidden branch lines per repository. */
  repoPath: string
  commits: Commit[]
  selection: Selection | null
  onSelect: (s: Selection) => void
  /** Opens history editing from this commit up to HEAD; unset to hide. */
  onRebaseFrom?: (commit: Commit) => void
  /** Asks for older commits; called when scrolling near the end. */
  onLoadMore?: () => void
  /** Cherry-pick, revert, reset, branches and tags in the right-click menu. */
  actions?: CommitActions
  filter?: HistoryFilter | null
  onFilter?: (f: HistoryFilter | null) => void
  /** The filter's results; null while they load. */
  filtered?: Commit[] | null
}

const ROW_HEIGHT = 52
const LANE_WIDTH = 14
const GRAPH_PADDING = 8
/** Older commits are requested this many rows before the end is reached. */
const LOAD_MORE_BEFORE = 50
/** Beyond this many lanes the graph is clipped so messages stay readable. */
const MAX_LANES = 12

// Distinguishable in both light and dark themes.
const LANE_COLORS = [
  '#5b78f6',
  '#e5534b',
  '#2da44e',
  '#d4a72c',
  '#a371f7',
  '#1f9eb1',
  '#e16f24',
  '#d6409f',
]

const laneColor = (i: number) => LANE_COLORS[i % LANE_COLORS.length]

export default function HistoryPanel({
  repoPath,
  commits: allCommits,
  selection,
  onSelect,
  onRebaseFrom,
  onLoadMore,
  actions,
  filter = null,
  onFilter,
  filtered = null,
}: Props) {
  // Filtered commits aren't connected, so they're listed without lines.
  const flat = filter !== null
  const [hidden, setHidden] = useState(() => readHiddenLines(repoPath))
  useEffect(() => setHidden(readHiddenLines(repoPath)), [repoPath])
  const updateHidden = (next: string[]) => {
    setHidden(next)
    writeHiddenLines(repoPath, next)
  }

  const source = flat ? (filtered ?? []) : allCommits
  const lineView = useMemo(
    () => hideLines(source, flat ? [] : hidden),
    [source, flat, hidden],
  )
  const { visible, layoutInput } = lineView
  const lines = flat ? [] : lineView.lines
  const canHide = (c: Commit) => !flat && lineView.canHide(c)

  // With lines hidden the rest is laid out again so it moves into the room.
  const [relaid, setRelaid] = useState<{
    input: unknown
    rows: GraphRow[]
  } | null>(null)
  useEffect(() => {
    if (!layoutInput) return
    let cancelled = false
    git
      .graphLayout(layoutInput)
      .then((rows) => !cancelled && setRelaid({ input: layoutInput, rows }))
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [layoutInput])

  const commits = useMemo(() => {
    if (!layoutInput || relaid?.input !== layoutInput) return visible
    // Keep each line's original color, so hiding one doesn't repaint others.
    const colorOf = new Map<number, number>()
    // A line's newest commit decides; older shared history can carry
    // another line's color.
    relaid.rows.forEach((r, i) => {
      if (!colorOf.has(r.color)) colorOf.set(r.color, visible[i].graph.color)
    })
    const recolor = (c: number) => colorOf.get(c) ?? c
    return visible.map((c, i) => {
      const row = relaid.rows[i]
      return {
        ...c,
        graph: {
          ...row,
          color: recolor(row.color),
          segments: row.segments.map((s) => ({
            ...s,
            color: recolor(s.color),
          })),
        },
      }
    })
  }, [visible, layoutInput, relaid])

  const hideLineOf = (c: Commit) => updateHidden([...hidden, c.hash].slice(-50))
  // Any commit stored for that line could be the one that identifies it.
  const showLine = (color: number) =>
    updateHidden(
      hidden.filter(
        (h) => allCommits.find((c) => c.hash === h)?.graph.color !== color,
      ),
    )

  const lanes = useMemo(
    () =>
      Math.min(MAX_LANES, Math.max(1, ...commits.map((c) => c.graph.width))),
    [commits],
  )

  const { menu, open } = useContextMenu()
  const [collapsed, setCollapsed] = useState(() => readFlag('graphCollapsed'))
  const toggleGraph = () => {
    writeFlag('graphCollapsed', !collapsed)
    setCollapsed(!collapsed)
  }
  const rows = useVirtualRows<HTMLUListElement>(commits.length, ROW_HEIGHT)

  function menuFor(c: Commit): MenuItem[] {
    const items: MenuItem[] = [
      {
        label: 'Copy commit hash',
        icon: Copy,
        onClick: () => copyText(c.hash),
      },
      {
        label: 'Copy short hash',
        icon: Copy,
        onClick: () => copyText(c.shortHash),
      },
      {
        label: 'Copy message',
        icon: GitCommitHorizontal,
        onClick: () => copyText(c.subject),
      },
    ]
    if (actions) {
      const isHead = c.refs.some((r) => r.kind === 'head')
      items.push(
        'separator',
        {
          label: 'Create branch here…',
          icon: GitBranchPlus,
          onClick: () => actions.createBranch(c),
        },
        {
          label: 'Create tag here…',
          icon: Tag,
          onClick: () => actions.createTag(c),
        },
      )
      for (const t of c.refs.filter((r) => r.kind === 'tag'))
        items.push(
          {
            label: `Push tag ${t.name}`,
            icon: Upload,
            onClick: () => actions.pushTag(t.name),
          },
          {
            label: `Delete tag ${t.name}…`,
            icon: Trash2,
            danger: true,
            onClick: () => actions.deleteTag(t.name),
          },
        )
      const branchItems: MenuItem[] = []
      if (actions.cherryPick)
        branchItems.push({
          label: 'Cherry-pick onto current branch',
          icon: CirclePlus,
          disabled: isHead,
          onClick: () => actions.cherryPick!(c),
        })
      if (actions.revert)
        branchItems.push({
          label: 'Revert this commit…',
          icon: Undo2,
          onClick: () => actions.revert!(c),
        })
      if (actions.reset)
        branchItems.push({
          label: 'Reset current branch to here…',
          icon: RotateCcw,
          disabled: isHead,
          onClick: () => actions.reset!(c),
        })
      if (branchItems.length > 0) items.push('separator', ...branchItems)
    }
    if (canHide(c))
      items.push('separator', {
        label: 'Hide this branch line',
        icon: EyeOff,
        onClick: () => hideLineOf(c),
      })
    if (onRebaseFrom && c.parents.length <= 1)
      items.push('separator', {
        label: 'Edit history from here…',
        icon: PencilLine,
        onClick: () => onRebaseFrom(c),
      })
    return items
  }
  const nearEnd = rows.end + LOAD_MORE_BEFORE >= commits.length
  useEffect(() => {
    if (!flat && nearEnd && commits.length > 0) onLoadMore?.()
  }, [flat, nearEnd, commits.length, onLoadMore])

  const dots = collapsed || flat
  // Collapsed, the graph is a single line of dots so messages get the room.
  const graphWidth = (dots ? 1 : lanes) * LANE_WIDTH + GRAPH_PADDING
  const empty = flat
    ? filtered === null
      ? 'Searching…'
      : filter.kind === 'search'
        ? 'No commits match'
        : 'No commits changed this file on this branch'
    : 'No commits yet'

  return (
    <>
      {onFilter && allCommits.length > 0 && (
        <FilterBar filter={filter} onFilter={onFilter} />
      )}
      {commits.length === 0 ? (
        <p className="p-6 text-center text-muted">{empty}</p>
      ) : (
        <>
          {!flat && (
            <div className="flex shrink-0 items-center gap-1 border-b border-line px-1 py-0.5 text-xs text-muted">
              <button
                onClick={toggleGraph}
                title={collapsed ? 'Show branch lines' : 'Hide branch lines'}
                aria-expanded={!collapsed}
                className="flex items-center gap-1.5 rounded px-1.5 py-0.5 hover:bg-hover hover:text-fg"
              >
                {collapsed ? (
                  <Plus className="size-3.5" />
                ) : (
                  <Minus className="size-3.5" />
                )}
                Graph
              </button>
              {lines.map((l) => (
                <button
                  key={l.color}
                  onClick={() => showLine(l.color)}
                  title={`Show ${l.label} again (${l.count} commit${l.count > 1 ? 's' : ''})`}
                  className="flex max-w-40 items-center gap-1 rounded border border-line px-1.5 py-0.5 hover:bg-hover hover:text-fg"
                >
                  <Plus className="size-3 shrink-0" />
                  <span
                    className="size-2 shrink-0 rounded-full"
                    style={{ background: laneColor(l.color) }}
                  />
                  <span className="truncate">{l.label}</span>
                </button>
              ))}
              {lines.length > 1 && (
                <button
                  onClick={() => updateHidden([])}
                  className="rounded px-1.5 py-0.5 hover:bg-hover hover:text-fg"
                >
                  Show all
                </button>
              )}
            </div>
          )}
          <ul ref={rows.ref} className="min-h-0 flex-1 overflow-auto">
            <li aria-hidden style={{ height: rows.top }} />
            {commits.slice(rows.start, rows.end).map((c) => {
              const selected =
                selection?.kind === 'commit' && selection.commit.hash === c.hash
              const isHead = c.refs.some((r) => r.kind === 'head')
              return (
                <li
                  key={c.hash}
                  onClick={() => onSelect({ kind: 'commit', commit: c })}
                  onContextMenu={(e) => {
                    onSelect({ kind: 'commit', commit: c })
                    open(e, menuFor(c))
                  }}
                  style={{ height: ROW_HEIGHT }}
                  className={`group flex cursor-default items-center pr-3 ${
                    selected ? 'bg-hover' : 'hover:bg-hover/60'
                  }`}
                >
                  {dots ? (
                    <DotCell
                      row={c.graph}
                      width={graphWidth}
                      isHead={isHead}
                      first={c === commits[0]}
                      last={c === commits[commits.length - 1]}
                    />
                  ) : (
                    <GraphCell
                      row={c.graph}
                      width={graphWidth}
                      isHead={isHead}
                      onHide={canHide(c) ? () => hideLineOf(c) : undefined}
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      {c.refs.map((r) => (
                        <RefBadge key={`${r.kind}:${r.name}`} label={r} />
                      ))}
                      <span className="truncate font-medium" title={c.subject}>
                        {c.subject}
                      </span>
                    </div>
                    <div className="mt-0.5 flex gap-2 text-xs text-muted">
                      <span className="truncate">{c.author}</span>
                      <span>·</span>
                      <span className="shrink-0">{relativeTime(c.time)}</span>
                      <span className="ml-auto shrink-0 font-mono">
                        {c.shortHash}
                      </span>
                      {onRebaseFrom && c.parents.length <= 1 && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            onRebaseFrom(c)
                          }}
                          title="Edit history from this commit: reorder, squash, reword or drop"
                          className="hidden shrink-0 items-center gap-1 rounded px-1 text-muted group-hover:flex hover:bg-line hover:text-fg"
                        >
                          <PencilLine className="size-3" />
                          Edit from here
                        </button>
                      )}
                    </div>
                  </div>
                </li>
              )
            })}
            <li aria-hidden style={{ height: rows.bottom }} />
          </ul>
        </>
      )}
      {menu}
    </>
  )
}

function FilterBar({
  filter,
  onFilter,
}: {
  filter: HistoryFilter | null
  onFilter: (f: HistoryFilter | null) => void
}) {
  // Typed text updates right away; the search itself waits a moment.
  const [text, setText] = useState(
    filter?.kind === 'search' ? filter.query : '',
  )
  useEffect(() => {
    if (filter?.kind !== 'search') setText('')
  }, [filter])

  if (filter?.kind === 'file')
    return (
      <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-1.5">
        <FileClock className="size-4 shrink-0 text-muted" />
        <span className="min-w-0 flex-1 truncate" title={filter.path}>
          <span className="text-muted">History of </span>
          <span className="font-medium">{filter.path}</span>
        </span>
        <button
          onClick={() => onFilter(null)}
          title="Show all commits"
          className="shrink-0 rounded p-0.5 text-muted hover:bg-hover hover:text-fg"
        >
          <X className="size-4" />
        </button>
      </div>
    )

  const change = (value: string) => {
    setText(value)
    onFilter(value.trim() ? { kind: 'search', query: value.trim() } : null)
  }
  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-1.5">
      <Search className="size-4 shrink-0 text-muted" />
      <input
        value={text}
        onChange={(e) => change(e.target.value)}
        onKeyDown={(e) => e.key === 'Escape' && change('')}
        placeholder="Search messages, authors or hashes"
        aria-label="Search commits"
        className="min-w-0 flex-1 bg-transparent outline-none"
      />
      {text && (
        <button
          onClick={() => change('')}
          title="Clear search"
          className="shrink-0 rounded p-0.5 text-muted hover:bg-hover hover:text-fg"
        >
          <X className="size-4" />
        </button>
      )}
    </div>
  )
}

function GraphCell({
  row,
  width,
  isHead,
  onHide,
}: {
  row: GraphRow
  width: number
  isHead: boolean
  /** Shows a "−" on the dot while the row is hovered. */
  onHide?: () => void
}) {
  const x = (lane: number) =>
    GRAPH_PADDING / 2 + lane * LANE_WIDTH + LANE_WIDTH / 2
  const y = (level: number) => (level * ROW_HEIGHT) / 2

  return (
    <svg width={width} height={ROW_HEIGHT} className="shrink-0 overflow-hidden">
      {row.segments.map((s, i) => {
        const [x1, y1, x2, y2] = [x(s.x1), y(s.y1), x(s.x2), y(s.y2)]
        const mid = (y1 + y2) / 2
        // Straight down for lanes, a smooth S-curve when switching lanes.
        const d =
          x1 === x2
            ? `M ${x1} ${y1} L ${x2} ${y2}`
            : `M ${x1} ${y1} C ${x1} ${mid}, ${x2} ${mid}, ${x2} ${y2}`
        return (
          <path
            key={i}
            d={d}
            fill="none"
            stroke={laneColor(s.color)}
            strokeWidth={2}
          />
        )
      })}
      <circle
        cx={x(row.lane)}
        cy={y(1)}
        r={isHead ? 5.5 : 4.5}
        fill={isHead ? 'var(--app-panel)' : laneColor(row.color)}
        stroke={isHead ? laneColor(row.color) : 'var(--app-panel)'}
        strokeWidth={isHead ? 3 : 2}
      />
      {onHide && (
        <g
          className="hidden cursor-pointer group-hover:inline"
          onClick={(e) => {
            e.stopPropagation()
            onHide()
          }}
        >
          <title>Hide this branch line</title>
          <circle
            cx={x(row.lane)}
            cy={y(1)}
            r={6.5}
            fill={laneColor(row.color)}
            stroke="var(--app-panel)"
            strokeWidth={1.5}
          />
          <path
            d={`M ${x(row.lane) - 3.5} ${y(1)} H ${x(row.lane) + 3.5}`}
            stroke="white"
            strokeWidth={2}
            strokeLinecap="round"
          />
        </g>
      )}
    </svg>
  )
}

/** The collapsed graph: every commit on one straight line, its dot still
 *  in the color of its branch line. */
function DotCell({
  row,
  width,
  isHead,
  first,
  last,
}: {
  row: GraphRow
  width: number
  isHead: boolean
  first: boolean
  last: boolean
}) {
  const x = GRAPH_PADDING / 2 + LANE_WIDTH / 2
  const mid = ROW_HEIGHT / 2
  return (
    <svg
      width={width}
      height={ROW_HEIGHT}
      className="shrink-0 overflow-hidden"
      aria-hidden
    >
      <line
        x1={x}
        x2={x}
        y1={first ? mid : 0}
        y2={last ? mid : ROW_HEIGHT}
        stroke="var(--app-line)"
        strokeWidth={2}
      />
      <circle
        cx={x}
        cy={mid}
        r={isHead ? 5.5 : 4.5}
        fill={isHead ? 'var(--app-panel)' : laneColor(row.color)}
        stroke={isHead ? laneColor(row.color) : 'var(--app-panel)'}
        strokeWidth={isHead ? 3 : 2}
      />
    </svg>
  )
}

const BADGE: Record<RefLabel['kind'], string> = {
  head: 'bg-accent text-on-accent',
  branch: 'border border-accent text-accent',
  remote: 'border border-line text-muted',
  tag: 'border border-modified text-modified',
}

function RefBadge({ label }: { label: RefLabel }) {
  return (
    <span
      title={label.kind === 'tag' ? `Tag ${label.name}` : label.name}
      className={`max-w-32 shrink-0 truncate rounded px-1.5 text-[11px] leading-4 font-medium ${BADGE[label.kind]}`}
    >
      {label.name}
    </span>
  )
}
