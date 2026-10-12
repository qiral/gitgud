import { useEffect, useMemo } from 'react'
import { PencilLine } from 'lucide-react'
import type { Commit, GraphRow, RefLabel } from '../lib/git'
import { relativeTime } from '../lib/time'
import { useVirtualRows } from '../lib/virtual'
import type { Selection } from './RepoView'

interface Props {
  commits: Commit[]
  selection: Selection | null
  onSelect: (s: Selection) => void
  /** Opens history editing from this commit up to HEAD; unset to hide. */
  onRebaseFrom?: (commit: Commit) => void
  /** Asks for older commits; called when scrolling near the end. */
  onLoadMore?: () => void
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
  commits,
  selection,
  onSelect,
  onRebaseFrom,
  onLoadMore,
}: Props) {
  const lanes = useMemo(
    () =>
      Math.min(MAX_LANES, Math.max(1, ...commits.map((c) => c.graph.width))),
    [commits],
  )

  const rows = useVirtualRows<HTMLUListElement>(commits.length, ROW_HEIGHT)
  const nearEnd = rows.end + LOAD_MORE_BEFORE >= commits.length
  useEffect(() => {
    if (nearEnd && commits.length > 0) onLoadMore?.()
  }, [nearEnd, commits.length, onLoadMore])

  if (commits.length === 0)
    return <p className="p-6 text-center text-muted">No commits yet</p>

  const graphWidth = lanes * LANE_WIDTH + GRAPH_PADDING

  return (
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
            style={{ height: ROW_HEIGHT }}
            className={`group flex cursor-default items-center pr-3 ${
              selected ? 'bg-hover' : 'hover:bg-hover/60'
            }`}
          >
            <GraphCell row={c.graph} width={graphWidth} isHead={isHead} />
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
  )
}

function GraphCell({
  row,
  width,
  isHead,
}: {
  row: GraphRow
  width: number
  isHead: boolean
}) {
  const x = (lane: number) =>
    GRAPH_PADDING / 2 + lane * LANE_WIDTH + LANE_WIDTH / 2
  const y = (level: number) => (level * ROW_HEIGHT) / 2

  return (
    <svg
      width={width}
      height={ROW_HEIGHT}
      className="shrink-0 overflow-hidden"
      aria-hidden
    >
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
    </svg>
  )
}

const BADGE: Record<RefLabel['kind'], string> = {
  head: 'bg-accent text-white',
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
