import { useEffect, useState } from 'react'
import {
  ArchiveRestore,
  Eye,
  GitBranchPlus,
  Loader2,
  RotateCcw,
} from 'lucide-react'
import {
  errorMessage,
  git,
  type Branch,
  type ReflogEntry,
  type RepoInfo,
} from '../lib/git'
import { relativeTime } from '../lib/time'
import Dialog from './Dialog'
import { useTranslation } from '../i18n'

interface Props {
  repo: RepoInfo
  branches: Branch[]
  onShow: (hash: string) => void
  onCreateBranch: (entry: ReflogEntry) => void
  /** Unset while the current branch can't be reset. */
  onReset?: (entry: ReflogEntry) => void
  onRecover: (hash: string) => Promise<boolean>
  onClose: () => void
}

/** Where HEAD and branches have been, and stashes that were deleted. */
export default function ReflogDialog({
  repo,
  branches,
  onShow,
  onCreateBranch,
  onReset,
  onRecover,
  onClose,
}: Props) {
  const { t } = useTranslation()
  /** "head", "stashes", or "branch:" and its name. */
  const [source, setSource] = useState('head')
  const [entries, setEntries] = useState<ReflogEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const stashes = source === 'stashes'

  useEffect(() => {
    let cancelled = false
    setEntries(null)
    setError(null)
    const load = stashes
      ? git.lostStashes(repo.path)
      : git.reflog(
          repo.path,
          source.startsWith('branch:') ? source.slice(7) : null,
        )
    load
      .then((e) => !cancelled && setEntries(e))
      .catch((e) => !cancelled && setError(errorMessage(e)))
    return () => {
      cancelled = true
    }
  }, [repo.path, source, stashes])

  /** Closes first: the action opens its own view or dialog. */
  const leave = (action: () => void) => {
    onClose()
    action()
  }
  const iconButton = 'rounded p-1 text-muted hover:bg-line hover:text-fg'

  return (
    <Dialog title={t('reflogdialog.title')} onClose={onClose} wide>
      <div className="space-y-3">
        <select
          aria-label={t('reflogdialog.source')}
          value={source}
          onChange={(e) => setSource(e.target.value)}
          className="w-full rounded border border-line bg-bg px-2 py-1.5 outline-none focus:border-accent"
        >
          <option value="head">{t('reflogdialog.everything')}</option>
          <option value="stashes">{t('reflogdialog.deleted-stashes')}</option>
          {branches.map((b) => (
            <option key={b.name} value={`branch:${b.name}`}>
              {b.name}
            </option>
          ))}
        </select>
        {error ? (
          <p className="whitespace-pre-wrap text-removed select-text">
            {error}
          </p>
        ) : entries === null ? (
          <div className="flex justify-center py-4 text-muted">
            <Loader2 className="size-4 animate-spin" />
          </div>
        ) : entries.length === 0 ? (
          <p className="text-muted">{t('reflogdialog.empty')}</p>
        ) : (
          <ul className="max-h-[60vh] overflow-auto rounded-md border border-line">
            {entries.map((e, i) => (
              <li
                key={i}
                className="group flex items-center gap-2 border-b border-line px-3 py-1.5 last:border-b-0 hover:bg-hover"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate" title={e.subject}>
                    {e.subject}
                  </span>
                  <span className="flex gap-2 text-xs text-muted">
                    <span className="shrink-0 font-mono">{e.shortHash}</span>
                    <span className="min-w-0 truncate" title={e.action}>
                      {e.action}
                    </span>
                    <span className="ml-auto shrink-0">
                      {relativeTime(e.time)}
                    </span>
                  </span>
                </span>
                {stashes ? (
                  <button
                    title={t('reflogdialog.recover')}
                    onClick={async () => {
                      if (await onRecover(e.hash))
                        setEntries((l) =>
                          (l ?? []).filter((x) => x.hash !== e.hash),
                        )
                      // The error is shown behind the dialog.
                      else onClose()
                    }}
                    className={iconButton}
                  >
                    <ArchiveRestore className="size-4" />
                  </button>
                ) : (
                  <>
                    <button
                      title={t('reflogdialog.show')}
                      onClick={() => leave(() => onShow(e.hash))}
                      className={iconButton}
                    >
                      <Eye className="size-4" />
                    </button>
                    <button
                      title={t('reflogdialog.create-branch')}
                      onClick={() => leave(() => onCreateBranch(e))}
                      className={iconButton}
                    >
                      <GitBranchPlus className="size-4" />
                    </button>
                    {onReset && (
                      <button
                        title={t('reflogdialog.reset')}
                        onClick={() => leave(() => onReset(e))}
                        className={iconButton}
                      >
                        <RotateCcw className="size-4" />
                      </button>
                    )}
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Dialog>
  )
}
