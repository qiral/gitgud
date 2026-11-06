import { useEffect, useState } from 'react'
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  GripVertical,
  Loader2,
} from 'lucide-react'
import {
  errorMessage,
  git,
  type Commit,
  type PlanCommit,
  type RebaseAction,
  type RepoInfo,
} from '../lib/git'
import Dialog from './Dialog'

interface Props {
  repo: RepoInfo
  /** The oldest commit to rewrite; it and everything after it are editable. */
  from: Commit
  onClose: () => void
  act: (label: string, action: () => Promise<unknown>) => Promise<boolean>
}

interface Row {
  commit: PlanCommit
  action: RebaseAction
  message: string
}

const ACTIONS: { value: RebaseAction; label: string; hint: string }[] = [
  { value: 'pick', label: 'Pick', hint: 'Keep the commit as it is' },
  { value: 'reword', label: 'Reword', hint: 'Keep it, change the message' },
  {
    value: 'squash',
    label: 'Squash',
    hint: 'Combine into the commit above, keeping both messages',
  },
  {
    value: 'fixup',
    label: 'Fixup',
    hint: 'Combine into the commit above, dropping this message',
  },
  { value: 'drop', label: 'Drop', hint: 'Remove the commit and its changes' },
]

export default function RebaseDialog({ repo, from, onClose, act }: Props) {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [pushed, setPushed] = useState(false)
  // Original order, to tell whether anything was moved.
  const [original, setOriginal] = useState<string[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [dragging, setDragging] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    git
      .rebasePlan(repo.path, from.hash)
      .then((plan) => {
        setPushed(plan.pushed)
        setOriginal(plan.commits.map((c) => c.hash))
        setRows(
          plan.commits.map((commit) => ({
            commit,
            action: 'pick',
            message: commit.message,
          })),
        )
      })
      .catch((e) => setLoadError(errorMessage(e)))
  }, [repo.path, from.hash])

  function update(i: number, change: Partial<Row>) {
    setRows(
      (r) => r && r.map((row, j) => (j === i ? { ...row, ...change } : row)),
    )
  }

  function move(src: number, dst: number) {
    setRows((r) => {
      if (!r || dst < 0 || dst >= r.length || src === dst) return r
      const next = [...r]
      const [row] = next.splice(src, 1)
      next.splice(dst, 0, row)
      return next
    })
  }

  const firstKept = rows?.find((r) => r.action !== 'drop')
  const problem = !rows
    ? null
    : firstKept &&
        (firstKept.action === 'squash' || firstKept.action === 'fixup')
      ? 'The first kept commit has nothing above it to squash into.'
      : rows.some((r) => r.action === 'reword' && !r.message.trim())
        ? 'A reworded commit needs a message.'
        : null
  const changed =
    rows?.some(
      (r, i) => r.action !== 'pick' || r.commit.hash !== original[i],
    ) ?? false

  async function start() {
    if (!rows || problem) return
    setBusy(true)
    const ok = await act('rebase', () =>
      git.rebaseStart(
        repo.path,
        from.hash,
        rows.map((r) => ({
          hash: r.commit.hash,
          action: r.action,
          message: r.action === 'reword' ? r.message : undefined,
        })),
      ),
    )
    setBusy(false)
    if (ok) onClose()
  }

  return (
    <Dialog title="Edit history" onClose={() => !busy && onClose()} wide>
      {loadError ? (
        <p className="text-removed select-text">{loadError}</p>
      ) : !rows ? (
        <div className="flex justify-center py-8 text-muted">
          <Loader2 className="size-5 animate-spin" />
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-muted">
            Oldest first. Drag to reorder, and choose what happens to each
            commit. Squash and fixup combine a commit into the one above it.
          </p>

          {pushed && (
            <p className="flex gap-2 rounded border border-modified bg-modified/10 p-2 text-xs">
              <AlertTriangle className="size-4 shrink-0 text-modified" />
              Some of these commits are already pushed. After rewriting them
              you'll need to force push, which affects anyone else using this
              branch.
            </p>
          )}

          <ul className="max-h-[50vh] space-y-1 overflow-auto">
            {rows.map((row, i) => (
              <li
                key={row.commit.hash}
                draggable
                onDragStart={(e) => {
                  setDragging(i)
                  e.dataTransfer.effectAllowed = 'move'
                }}
                onDragOver={(e) => {
                  e.preventDefault()
                  if (dragging !== null && dragging !== i) {
                    move(dragging, i)
                    setDragging(i)
                  }
                }}
                onDragEnd={() => setDragging(null)}
                className={`rounded border border-line bg-bg p-2 ${
                  dragging === i ? 'opacity-50' : ''
                } ${row.action === 'drop' ? 'opacity-60' : ''}`}
              >
                <div className="flex items-center gap-2">
                  <GripVertical className="size-4 shrink-0 cursor-grab text-muted" />
                  <select
                    value={row.action}
                    onChange={(e) =>
                      update(i, { action: e.target.value as RebaseAction })
                    }
                    title={ACTIONS.find((a) => a.value === row.action)?.hint}
                    className="rounded border border-line bg-panel px-1 py-0.5 text-xs"
                  >
                    {ACTIONS.map((a) => (
                      <option key={a.value} value={a.value} title={a.hint}>
                        {a.label}
                      </option>
                    ))}
                  </select>
                  <span
                    className={`min-w-0 flex-1 truncate ${
                      row.action === 'drop' ? 'line-through' : ''
                    } ${row.action === 'squash' || row.action === 'fixup' ? 'pl-4 text-muted' : ''}`}
                    title={row.commit.subject}
                  >
                    {row.commit.subject}
                  </span>
                  <span className="shrink-0 font-mono text-xs text-muted">
                    {row.commit.shortHash}
                  </span>
                  <button
                    onClick={() => move(i, i - 1)}
                    disabled={i === 0}
                    title="Move up"
                    className="rounded p-0.5 text-muted hover:bg-hover hover:text-fg disabled:opacity-30"
                  >
                    <ArrowUp className="size-3.5" />
                  </button>
                  <button
                    onClick={() => move(i, i + 1)}
                    disabled={i === rows.length - 1}
                    title="Move down"
                    className="rounded p-0.5 text-muted hover:bg-hover hover:text-fg disabled:opacity-30"
                  >
                    <ArrowDown className="size-3.5" />
                  </button>
                </div>
                {row.action === 'reword' && (
                  <textarea
                    value={row.message}
                    onChange={(e) => update(i, { message: e.target.value })}
                    rows={3}
                    className="mt-2 w-full resize-none rounded border border-line bg-panel p-2 font-mono text-xs outline-none select-text focus:border-accent"
                  />
                )}
              </li>
            ))}
          </ul>

          {problem && <p className="text-xs text-removed">{problem}</p>}
          <button
            onClick={start}
            disabled={busy || !!problem || !changed}
            className="flex w-full items-center justify-center gap-2 rounded bg-accent py-2 font-medium text-on-accent hover:opacity-90 disabled:opacity-40"
          >
            {busy && <Loader2 className="size-4 animate-spin" />}
            Rewrite {rows.length} commit{rows.length > 1 ? 's' : ''}
          </button>
        </div>
      )}
    </Dialog>
  )
}
