import { useEffect, useState } from 'react'
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  GripVertical,
  Loader2,
  Sparkles,
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
import { useTranslation, type Translate } from '../i18n'

interface Props {
  repo: RepoInfo
  /** The oldest commit to rewrite; it and everything after it are editable. */
  from: Commit
  onClose: () => void
  act: (label: string, action: () => Promise<unknown>) => Promise<boolean>
  /** Writes one message for commits squashed together, oldest first; null
   *  when it failed. Unset to hide the button. */
  suggestSquashMessage?: (hashes: string[]) => Promise<string | null>
}

interface Row {
  commit: PlanCommit
  action: RebaseAction
  message: string
  /** New message for a kept commit and the ones squashed into it; empty
   *  keeps git's combined message. */
  combined: string
}

/** Hashes of the commits squashed or fixed up into rows[i]. */
function foldedInto(rows: Row[], i: number) {
  const hashes: string[] = []
  for (const row of rows.slice(i + 1)) {
    if (row.action === 'pick' || row.action === 'reword') break
    if (row.action !== 'drop') hashes.push(row.commit.hash)
  }
  return hashes
}

const ACTIONS = (
  t: Translate,
): { value: RebaseAction; label: string; hint: string }[] => [
  {
    value: 'pick',
    label: t('rebasedialog.pick'),
    hint: t('rebasedialog.hint-pick'),
  },
  {
    value: 'reword',
    label: t('rebasedialog.reword'),
    hint: t('rebasedialog.hint-reword'),
  },
  {
    value: 'squash',
    label: t('rebasedialog.squash'),
    hint: t('rebasedialog.hint-squash'),
  },
  {
    value: 'fixup',
    label: t('rebasedialog.fixup'),
    hint: t('rebasedialog.hint-fixup'),
  },
  {
    value: 'drop',
    label: t('rebasedialog.drop'),
    hint: t('rebasedialog.hint-drop'),
  },
]

export default function RebaseDialog({
  repo,
  from,
  onClose,
  act,
  suggestSquashMessage,
}: Props) {
  const { t } = useTranslation()
  const [rows, setRows] = useState<Row[] | null>(null)
  const [pushed, setPushed] = useState(false)
  // Original order, to tell whether anything was moved.
  const [original, setOriginal] = useState<string[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [dragging, setDragging] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  // The commit Copilot is writing a combined message for.
  const [suggesting, setSuggesting] = useState<string | null>(null)

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
            combined: '',
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

  async function suggest(i: number) {
    if (!rows || !suggestSquashMessage || suggesting) return
    const hash = rows[i].commit.hash
    setSuggesting(hash)
    try {
      const message = await suggestSquashMessage([hash, ...foldedInto(rows, i)])
      if (message !== null)
        setRows(
          (r) =>
            r &&
            r.map((row) =>
              row.commit.hash === hash ? { ...row, combined: message } : row,
            ),
        )
    } finally {
      setSuggesting(null)
    }
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
      ? t('rebasedialog.squash-first')
      : rows.some((r) => r.action === 'reword' && !r.message.trim())
        ? t('rebasedialog.reword-empty')
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
        rows.map((r, i) => ({
          hash: r.commit.hash,
          action: r.action,
          message:
            r.action === 'reword'
              ? r.message
              : r.action === 'pick' &&
                  r.combined.trim() &&
                  foldedInto(rows, i).length > 0
                ? r.combined
                : undefined,
        })),
      ),
    )
    setBusy(false)
    if (ok) onClose()
  }

  return (
    <Dialog
      title={t('rebasedialog.edit-history')}
      onClose={() => !busy && onClose()}
      wide
    >
      {loadError ? (
        <p className="text-removed select-text">{loadError}</p>
      ) : !rows ? (
        <div className="flex justify-center py-8 text-muted">
          <Loader2 className="size-5 animate-spin" />
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-muted">
            {t(
              'rebasedialog.oldest-first-drag-to-reorder-and-choose-what-happens-to-each-commit-squash-and-fixup-combine-a-commit-into-the-one-above-it',
            )}
          </p>

          {pushed && (
            <p className="flex gap-2 rounded border border-modified bg-modified/10 p-2 text-xs">
              <AlertTriangle className="size-4 shrink-0 text-modified" />
              {t(
                'rebasedialog.some-of-these-commits-are-already-pushed-after-rewriting-them-you-ll-need-to-force-push-which-affects-anyone-else-using-this-branch',
              )}
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
                    title={ACTIONS(t).find((a) => a.value === row.action)?.hint}
                    className="rounded border border-line bg-panel px-1 py-0.5 text-xs"
                  >
                    {ACTIONS(t).map((a) => (
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
                    title={t('rebasedialog.move-up')}
                    className="rounded p-0.5 text-muted hover:bg-hover hover:text-fg disabled:opacity-30"
                  >
                    <ArrowUp className="size-3.5" />
                  </button>
                  <button
                    onClick={() => move(i, i + 1)}
                    disabled={i === rows.length - 1}
                    title={t('rebasedialog.move-down')}
                    className="rounded p-0.5 text-muted hover:bg-hover hover:text-fg disabled:opacity-30"
                  >
                    <ArrowDown className="size-3.5" />
                  </button>
                </div>
                {(row.action === 'reword' ||
                  (row.action === 'pick' &&
                    foldedInto(rows, i).length > 0)) && (
                  <MessageField
                    value={row.action === 'reword' ? row.message : row.combined}
                    placeholder={
                      row.action === 'pick'
                        ? t('rebasedialog.combined-message-placeholder')
                        : undefined
                    }
                    onChange={(value) =>
                      update(
                        i,
                        row.action === 'reword'
                          ? { message: value }
                          : { combined: value },
                      )
                    }
                    suggesting={suggesting === row.commit.hash}
                    disabled={suggesting !== null}
                    onSuggest={
                      suggestSquashMessage && row.action === 'pick'
                        ? () => suggest(i)
                        : undefined
                    }
                  />
                )}
              </li>
            ))}
          </ul>

          {problem && <p className="text-xs text-removed">{problem}</p>}
          <button
            onClick={start}
            disabled={busy || !!problem || !changed || suggesting !== null}
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

function MessageField({
  value,
  placeholder,
  onChange,
  suggesting,
  disabled,
  onSuggest,
}: {
  value: string
  placeholder?: string
  onChange: (value: string) => void
  suggesting: boolean
  /** Another message is being written. */
  disabled: boolean
  onSuggest?: () => void
}) {
  const { t } = useTranslation()
  return (
    <div className="relative mt-2">
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={3}
        className="w-full resize-none rounded border border-line bg-panel p-2 pr-8 font-mono text-xs outline-none select-text focus:border-accent"
      />
      {onSuggest && (
        <button
          onClick={onSuggest}
          disabled={disabled}
          title={t('rebasedialog.write-combined-message-with-copilot')}
          aria-label={t('rebasedialog.write-combined-message-with-copilot')}
          className="absolute top-1.5 right-1.5 rounded p-1 text-muted hover:bg-hover hover:text-fg disabled:opacity-40"
        >
          {suggesting ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Sparkles className="size-4" />
          )}
        </button>
      )}
    </div>
  )
}
