import { useEffect, useState } from 'react'
import { ArrowLeftRight, ArrowLeft, Loader2, X } from 'lucide-react'
import {
  errorMessage,
  git,
  type Branch,
  type Commit,
  type Differences,
} from '../lib/git'
import { splitDiff } from '../lib/diff'
import { useDiffPrefs } from '../lib/diffPrefs'
import { relativeTime } from '../lib/time'
import PatchView from './PatchView'
import { useTranslation } from '../i18n'

/** One side of a comparison. */
export interface CompareSide {
  /** A full ref name, so a tag of the same name can't get in the way, or a
   *  commit hash. */
  rev: string
  label: string
}

export interface CompareTarget {
  base: CompareSide
  head: CompareSide
}

export const branchSide = (name: string): CompareSide => ({
  rev: `refs/heads/${name}`,
  label: name,
})
export const remoteSide = (name: string): CompareSide => ({
  rev: `refs/remotes/${name}`,
  label: name,
})
export const commitSide = (
  c: Pick<Commit, 'hash' | 'shortHash'>,
): CompareSide => ({ rev: c.hash, label: c.shortHash })

/** Two commits are compared as they are; branches since they split. */
export const isCommit = (s: CompareSide) => !s.rev.startsWith('refs/')

type Tab = 'files' | 'ahead' | 'behind'

interface Props {
  repo: string
  target: CompareTarget
  branches: Branch[]
  remoteBranches: string[]
  /** Compares again whenever this changes. */
  version: unknown
  onChange: (target: CompareTarget) => void
  onShowCommit: (hash: string) => void
  onFileHistory: (path: string) => void
  onBlame: (path: string, rev: string) => void
  onClose: () => void
}

/** What differs between two branches or commits, and the commits only one
 *  of them has. */
export default function CompareView({
  repo,
  target,
  branches,
  remoteBranches,
  version,
  onChange,
  onShowCommit,
  onFileHistory,
  onBlame,
  onClose,
}: Props) {
  const { t, tp } = useTranslation()
  const { ignoreWhitespace } = useDiffPrefs()
  const { base, head } = target
  const commits = isCommit(base) && isCommit(head)
  const [direct, setDirect] = useState(commits)
  const [tab, setTab] = useState<Tab>('files')
  const [loaded, setLoaded] = useState<{
    key: string
    differences: Differences
  } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const key = [base.rev, head.rev, direct].join('\n')

  useEffect(() => setDirect(commits), [commits])

  useEffect(() => {
    let cancelled = false
    git
      .compare(repo, base.rev, head.rev, direct, ignoreWhitespace)
      .then((differences) => {
        if (cancelled) return
        setError(null)
        setLoaded({ key, differences })
      })
      .catch((e) => !cancelled && setError(errorMessage(e)))
    return () => {
      cancelled = true
    }
  }, [repo, base.rev, head.rev, direct, ignoreWhitespace, version, key])

  // What's shown stays up while it reloads, but not for another comparison.
  const d = loaded?.key === key ? loaded.differences : null

  const sides = [
    {
      label: t('compare.branches'),
      list: branches.map((b) => branchSide(b.name)),
    },
    {
      label: t('compare.remote-branches'),
      list: remoteBranches.map(remoteSide),
    },
  ].filter((g) => g.list.length > 0)

  const select = (
    label: string,
    value: CompareSide,
    onPick: (side: CompareSide) => void,
  ) => (
    <select
      aria-label={label}
      title={label}
      value={value.rev}
      onChange={(e) => {
        const side = sides
          .flatMap((g) => g.list)
          .find((s) => s.rev === e.target.value)
        if (side) onPick(side)
      }}
      className="max-w-64 min-w-0 truncate rounded border border-line bg-bg px-2 py-1 font-medium outline-none focus:border-accent"
    >
      {!sides.some((g) => g.list.some((s) => s.rev === value.rev)) && (
        <option value={value.rev}>{value.label}</option>
      )}
      {sides.map((g) => (
        <optgroup key={g.label} label={g.label}>
          {g.list.map((s) => (
            <option key={s.rev} value={s.rev}>
              {s.label}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  )

  const files = d ? splitDiff(d.diff).files.length : 0
  const tabs: { id: Tab; label: string }[] = d
    ? [
        { id: 'files', label: tp('compare.files', files) },
        { id: 'ahead', label: tp('compare.ahead', d.aheadCount) },
        { id: 'behind', label: tp('compare.behind', d.behindCount) },
      ]
    : []
  const tabHint: Record<Tab, string> = {
    files: '',
    ahead: t('compare.only-in', { name: head.label }),
    behind: t('compare.only-in', { name: base.label }),
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b border-line px-4 pt-3">
        <div className="flex items-center gap-2">
          {select(t('compare.base'), base, (s) => onChange({ base: s, head }))}
          <ArrowLeft className="size-4 shrink-0 text-muted" aria-hidden />
          {select(t('compare.head'), head, (s) => onChange({ base, head: s }))}
          <button
            onClick={() => onChange({ base: head, head: base })}
            title={t('compare.swap')}
            aria-label={t('compare.swap')}
            className="rounded p-1.5 text-muted hover:bg-hover hover:text-fg"
          >
            <ArrowLeftRight className="size-4" />
          </button>
          <span className="flex-1" />
          <label
            title={t('compare.direct-hint')}
            className="flex shrink-0 items-center gap-1.5 text-xs text-muted"
          >
            <input
              type="checkbox"
              checked={direct}
              onChange={(e) => setDirect(e.target.checked)}
            />
            {t('compare.direct')}
          </label>
          <button
            onClick={onClose}
            title={t('compare.close')}
            aria-label={t('compare.close')}
            className="rounded p-1.5 text-muted hover:bg-hover hover:text-fg"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="mt-2 flex h-8 gap-4 text-xs">
          {tabs.map((x) => (
            <button
              key={x.id}
              onClick={() => setTab(x.id)}
              title={tabHint[x.id]}
              aria-pressed={tab === x.id}
              className={`-mb-px border-b-2 ${
                tab === x.id
                  ? 'border-accent text-fg'
                  : 'border-transparent text-muted hover:text-fg'
              }`}
            >
              {x.label}
            </button>
          ))}
          {d && !d.related && (
            <span className="self-center text-modified">
              {t('compare.unrelated')}
            </span>
          )}
        </div>
      </div>
      {error ? (
        <p className="p-6 whitespace-pre-wrap text-removed select-text">
          {error}
        </p>
      ) : !d ? (
        <div className="flex justify-center p-6 text-muted">
          <Loader2 className="size-5 animate-spin" />
        </div>
      ) : tab === 'files' ? (
        <div className="min-h-0 flex-1">
          <PatchView
            repo={repo}
            patch={d.diff}
            header={null}
            empty={t('compare.no-differences')}
            onFileHistory={onFileHistory}
            onBlame={(path) => onBlame(path, d.headHash)}
          />
        </div>
      ) : (
        <CommitList
          commits={tab === 'ahead' ? d.ahead : d.behind}
          total={tab === 'ahead' ? d.aheadCount : d.behindCount}
          onShow={onShowCommit}
        />
      )}
    </div>
  )
}

function CommitList({
  commits,
  total,
  onShow,
}: {
  commits: Commit[]
  total: number
  onShow: (hash: string) => void
}) {
  const { t, tp } = useTranslation()
  if (commits.length === 0)
    return <p className="p-6 text-muted">{t('compare.no-commits')}</p>
  return (
    <ul className="min-h-0 flex-1 overflow-auto">
      {commits.map((c) => (
        <li key={c.hash}>
          <button
            onClick={() => onShow(c.hash)}
            className="block w-full px-4 py-2 text-left hover:bg-hover"
          >
            <span className="block truncate font-medium">{c.subject}</span>
            <span className="mt-0.5 flex gap-2 text-xs text-muted">
              <span className="truncate">{c.author}</span>
              <span>·</span>
              <span className="shrink-0">{relativeTime(c.time)}</span>
              <span className="ml-auto shrink-0 font-mono">{c.shortHash}</span>
            </span>
          </button>
        </li>
      ))}
      {total > commits.length && (
        <li className="px-4 py-2 text-xs text-muted">
          {tp('compare.more', total - commits.length)}
        </li>
      )}
    </ul>
  )
}
