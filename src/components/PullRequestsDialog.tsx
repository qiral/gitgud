import { useEffect, useState } from 'react'
import {
  Check,
  CircleDot,
  Download,
  ExternalLink,
  Eye,
  GitPullRequest,
  GitPullRequestDraft,
  Loader2,
  MessageSquareWarning,
  X,
} from 'lucide-react'
import {
  errorMessage,
  github,
  type PullDetails,
  type PullList,
  type RepoInfo,
} from '../lib/git'
import { openUrl } from '../lib/open'
import { relativeTime } from '../lib/time'
import { fuzzyFilter } from '../lib/fuzzy'
import Dialog from './Dialog'
import { useTranslation } from '../i18n'

const CHECKS = {
  passed: { icon: Check, color: 'text-added' },
  failed: { icon: X, color: 'text-removed' },
  pending: { icon: CircleDot, color: 'text-modified' },
}

const REVIEWS = {
  approved: { icon: Check, color: 'text-added' },
  changesRequested: { icon: MessageSquareWarning, color: 'text-removed' },
  required: { icon: Eye, color: 'text-muted' },
}

/** How the checks of a pull request went. */
export function ChecksIcon({ checks }: { checks: PullDetails['checks'] }) {
  const { t } = useTranslation()
  if (!checks) return null
  const { icon: Icon, color } = CHECKS[checks]
  const label = t(`pulls.checks-${checks}`)
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={`shrink-0 ${color}`}
    >
      <Icon className="size-3.5" />
    </span>
  )
}

interface Props {
  repo: RepoInfo
  busy: boolean
  /** Null when not signed in. */
  onSignIn: (() => void) | null
  act: (label: string, action: () => Promise<unknown>) => Promise<boolean>
  onClose: () => void
}

/** The repository's open pull requests, to look at or check out. */
export default function PullRequestsDialog({
  repo,
  busy,
  onSignIn,
  act,
  onClose,
}: Props) {
  const { t, tp } = useTranslation()
  const [list, setList] = useState<PullList | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [checkingOut, setCheckingOut] = useState<number | null>(null)

  useEffect(() => {
    if (onSignIn) return
    let cancelled = false
    github
      .pulls(repo.path)
      .then((l) => !cancelled && setList(l))
      .catch((e) => !cancelled && setError(errorMessage(e)))
    return () => {
      cancelled = true
    }
  }, [repo.path, !onSignIn])

  async function checkOut(p: PullDetails) {
    if (!list) return
    setCheckingOut(p.number)
    setError(null)
    let failure: string | null = null
    const done = await act('switch', async () => {
      try {
        await github.checkoutPull(repo.path, list.repo, p.number)
      } catch (e) {
        failure = errorMessage(e)
        throw e
      }
    })
    setCheckingOut(null)
    if (done) onClose()
    else setError(failure)
  }

  const shown = list
    ? fuzzyFilter(
        query,
        list.pulls,
        (p) => `#${p.number} ${p.title} ${p.author ?? ''} ${p.head}`,
      )
    : []

  return (
    <Dialog
      title={list ? t('pulls.title-of', { repo: list.repo }) : t('pulls.title')}
      onClose={onClose}
      size="lg"
    >
      {onSignIn ? (
        <div className="space-y-3 py-4 text-center">
          <p className="text-muted">{t('pulls.sign-in-first')}</p>
          <button
            onClick={onSignIn}
            className="rounded bg-accent px-4 py-1.5 font-medium text-on-accent hover:opacity-90"
          >
            {t('toolbar.sign-in-to-github')}
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {error && (
            <p className="whitespace-pre-wrap text-removed select-text">
              {error}
            </p>
          )}
          {!list ? (
            !error && (
              <div className="flex justify-center p-6 text-muted">
                <Loader2 className="size-5 animate-spin" />
              </div>
            )
          ) : list.pulls.length === 0 ? (
            <p className="py-4 text-center text-muted">{t('pulls.none')}</p>
          ) : (
            <>
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('pulls.filter')}
                aria-label={t('pulls.filter')}
                className="w-full rounded border border-line bg-bg px-2 py-1.5 outline-none focus:border-accent"
              />
              <ul className="max-h-[55vh] overflow-auto rounded-md border border-line">
                {shown.map((p) => (
                  <li
                    key={p.number}
                    className="flex items-center gap-3 border-b border-line px-3 py-2 last:border-b-0"
                  >
                    {p.draft ? (
                      <GitPullRequestDraft className="size-4 shrink-0 text-muted" />
                    ) : (
                      <GitPullRequest className="size-4 shrink-0 text-added" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate font-medium" title={p.title}>
                          {p.title}
                        </span>
                        <span className="shrink-0 text-muted">#{p.number}</span>
                        <ChecksIcon checks={p.checks} />
                      </div>
                      <div className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-muted">
                        {p.author && <span>{p.author}</span>}
                        <span className="min-w-0 truncate font-mono">
                          {p.head} → {p.base}
                        </span>
                        <span>
                          {relativeTime(Date.parse(p.updatedAt) / 1000)}
                        </span>
                        {p.draft && <span>{t('pulls.draft')}</span>}
                        {p.review && <ReviewLabel review={p.review} />}
                      </div>
                    </div>
                    <button
                      onClick={() => openUrl(p.url)}
                      title={t('pulls.open-on-github')}
                      aria-label={t('pulls.open-on-github')}
                      className="shrink-0 rounded p-1 text-muted hover:bg-hover hover:text-fg"
                    >
                      <ExternalLink className="size-4" />
                    </button>
                    <button
                      onClick={() => checkOut(p)}
                      disabled={busy}
                      className="flex shrink-0 items-center gap-1.5 rounded border border-line px-2 py-1 text-xs whitespace-nowrap hover:bg-hover disabled:opacity-40"
                    >
                      {checkingOut === p.number ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <Download className="size-3.5" />
                      )}
                      {t('pulls.check-out')}
                    </button>
                  </li>
                ))}
                {shown.length === 0 && (
                  <li className="p-4 text-center text-muted">
                    {t('pulls.no-match')}
                  </li>
                )}
              </ul>
              {list.total > list.pulls.length && (
                <p className="text-xs text-muted">
                  {tp('pulls.more', list.total - list.pulls.length)}
                </p>
              )}
            </>
          )}
        </div>
      )}
    </Dialog>
  )
}

function ReviewLabel({
  review,
}: {
  review: NonNullable<PullDetails['review']>
}) {
  const { t } = useTranslation()
  const { icon: Icon, color } = REVIEWS[review]
  return (
    <span className={`flex items-center gap-1 ${color}`}>
      <Icon className="size-3" />
      {t(`pulls.review-${review}`)}
    </span>
  )
}
