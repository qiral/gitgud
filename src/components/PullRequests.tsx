import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import { openUrl } from '../lib/open'
import {
  ExternalLink,
  GitPullRequest,
  GitPullRequestArrow,
  GitPullRequestDraft,
  Loader2,
  Sparkles,
} from 'lucide-react'
import {
  copilot,
  errorMessage,
  github,
  type Comparison,
  type PullRequest,
  type PullTarget,
  type RepoInfo,
  type Status,
} from '../lib/git'
import Dialog from './Dialog'
import type { Command } from './CommandPalette'
import { useTranslation } from '../i18n'
import { useCopilotPrefs } from '../lib/copilotPrefs'

/** Looks up the pull request again at most this often when the window gets
 *  focus, e.g. after merging it on GitHub. */
const RECHECK_MS = 60_000

/** "feature/login-page" -> "Login page" */
export function titleFromBranch(branch: string) {
  const words = branch
    .slice(branch.lastIndexOf('/') + 1)
    .replace(/[-_]+/g, ' ')
    .trim()
  return words ? words[0].toUpperCase() + words.slice(1) : branch
}

/** A title and description from the commits, before anyone edits them. */
export function draftFromCommits(branch: string, commits: string[]) {
  if (commits.length === 1) {
    const [subject, ...rest] = commits[0].trim().split('\n')
    return { title: subject, body: rest.join('\n').trim() }
  }
  return {
    title: titleFromBranch(branch),
    body: commits.map((m) => `- ${m.trim().split('\n')[0]}`).join('\n'),
  }
}

/** Splits Copilot's reply: the first line is the title. */
export function splitReply(reply: string) {
  const [title, ...rest] = reply.trim().split('\n')
  return {
    title: title.replace(/^#+\s*/, '').trim(),
    body: rest.join('\n').trim(),
  }
}

interface Options {
  repo: RepoInfo
  status: Status | null
  signedIn: boolean
  onSignIn: () => void
  /** Pushes the current branch; resolves to false if that failed. */
  push: () => Promise<boolean>
  /** Runs a Copilot request; see useCopilot. */
  ask: <T>(task: () => Promise<T>) => Promise<T | null>
}

/**
 * The current branch's GitHub pull request: shown in the toolbar, created
 * from a dialog, and offered in the command palette.
 */
export function usePullRequests(o: Options) {
  const { t } = useTranslation()
  const [target, setTarget] = useState<PullTarget | null>(null)
  const [creating, setCreating] = useState(false)
  const checked = useRef(0)
  const branch = o.status?.branch ?? null
  const upstream = o.status?.upstream ?? null

  const load = useCallback(() => {
    checked.current = Date.now()
    if (!o.signedIn || !branch || !upstream) {
      setTarget(null)
      return
    }
    github
      .pullTarget(o.repo.path)
      .then(setTarget)
      // Not on GitHub, offline or no access: just no pull request button.
      .catch(() => setTarget(null))
  }, [o.repo.path, o.signedIn, branch, upstream])

  useEffect(load, [load])
  useEffect(() => {
    const onFocus = () => Date.now() - checked.current > RECHECK_MS && load()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [load])

  const open = target?.existing?.state === 'open' ? target.existing : null
  // A branch can't be merged into itself.
  const canCreate =
    target !== null &&
    !open &&
    !(
      target.baseRepo === target.headRepo &&
      target.branch === target.defaultBase
    )

  const commands: Command[] = [
    open
      ? {
          id: 'pullRequest',
          group: t('repocommands.group-remote'),
          label: t('pullrequests.view-pull-request', { number: open.number }),
          detail: open.title,
          icon: GitPullRequest,
          shortcut: 'mod+r',
          run: () => openUrl(open.url),
        }
      : {
          id: 'pullRequest',
          group: t('repocommands.group-remote'),
          label: t('pullrequests.create-pull-request-ellipsis'),
          detail:
            o.signedIn && !target && branch
              ? t('pullrequests.push-the-branch-first')
              : undefined,
          icon: GitPullRequestArrow,
          shortcut: 'mod+r',
          disabled: o.signedIn && !canCreate,
          run: () => (o.signedIn ? setCreating(true) : o.onSignIn()),
        },
    {
      id: 'openOnGitHub',
      group: t('repocommands.group-remote'),
      label: t('pullrequests.open-branch-on-github'),
      icon: ExternalLink,
      disabled: !target,
      run: () =>
        target &&
        openUrl(
          `https://github.com/${target.headRepo}/tree/${encodeURIComponent(target.branch)}`,
        ),
    },
  ]

  const button = open ? (
    <PullRequestButton
      label={
        open.draft
          ? t('pullrequests.number-draft', { number: open.number })
          : `#${open.number}`
      }
      title={open.title}
      icon={open.draft ? GitPullRequestDraft : GitPullRequest}
      onClick={() => openUrl(open.url)}
    />
  ) : canCreate ? (
    <PullRequestButton
      label={t('pullrequests.create')}
      title={t('pullrequests.open-into', { repo: target!.baseRepo })}
      icon={GitPullRequestArrow}
      onClick={() => setCreating(true)}
    />
  ) : null

  const dialog = creating && target && (
    <CreatePullRequestDialog
      repo={o.repo}
      target={target}
      unpushed={o.status?.ahead ?? 0}
      push={o.push}
      ask={o.ask}
      onClose={() => setCreating(false)}
      onCreated={(pr) => {
        setCreating(false)
        setTarget({ ...target, existing: pr })
        openUrl(pr.url)
      }}
    />
  )

  return { target, button, commands, dialog, reload: load }
}

function PullRequestButton({
  label,
  title,
  icon: Icon,
  onClick,
}: {
  label: string
  title: string
  icon: typeof GitPullRequest
  onClick: () => void
}) {
  const { t } = useTranslation()
  return (
    <button
      onClick={onClick}
      title={title}
      className="flex min-w-32 items-center gap-3 border-r border-line px-4 text-left hover:bg-hover"
    >
      <Icon className="size-4 text-muted" />
      <span className="flex min-w-0 flex-1 flex-col leading-tight">
        <span className="text-xs text-muted">
          {t('pullrequests.pull-request')}
        </span>
        <span className="truncate font-medium">{label}</span>
      </span>
    </button>
  )
}

/** Puts elements into a translated sentence's {placeholders}, so each
 *  language can order them its own way. Text between them, string values
 *  included, stays together in one span. */
function fill(text: string, parts: Record<string, React.ReactNode>) {
  const out: React.ReactNode[] = []
  let run = ''
  const flush = () => {
    if (run.trim()) out.push(<span key={out.length}>{run.trim()}</span>)
    run = ''
  }
  for (const piece of text.split(/(\{\w+\})/)) {
    const name = /^\{(\w+)\}$/.exec(piece)?.[1]
    const part = name && name in parts ? parts[name] : piece
    if (typeof part === 'string') run += part
    else {
      flush()
      out.push(<Fragment key={out.length}>{part}</Fragment>)
    }
  }
  flush()
  return out
}

interface DialogProps {
  repo: RepoInfo
  target: PullTarget
  /** Local commits not pushed yet; they're pushed before creating. */
  unpushed: number
  push: () => Promise<boolean>
  ask: Options['ask']
  onClose: () => void
  onCreated: (pr: PullRequest) => void
}

export function CreatePullRequestDialog({
  repo,
  target,
  unpushed,
  push,
  ask,
  onClose,
  onCreated,
}: DialogProps) {
  const { t, tp } = useTranslation()
  const [bases, setBases] = useState<string[]>([target.defaultBase])
  const [base, setBase] = useState(target.defaultBase)
  const [comparison, setComparison] = useState<Comparison | null>(null)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  // Once typed in, the fields aren't refilled from the commits.
  const edited = useRef(false)
  const [draft, setDraft] = useState(false)
  const [busy, setBusy] = useState<'create' | 'copilot' | null>(null)
  const copilotOn = useCopilotPrefs().pullRequest
  const [error, setError] = useState<string | null>(null)
  const sameRepo = target.baseRepo === target.headRepo

  useEffect(() => {
    github
      .branches(target.baseRepo)
      .then((list) => {
        const names = sameRepo ? list.filter((b) => b !== target.branch) : list
        // Keep the default first, it's the usual choice.
        setBases([
          target.defaultBase,
          ...names.filter((b) => b !== target.defaultBase),
        ])
      })
      .catch(() => {})
  }, [target, sameRepo])

  useEffect(() => {
    let cancelled = false
    setComparison(null)
    github
      .compare(target.baseRepo, base, target.headRepo, target.branch)
      .then((c) => {
        if (cancelled) return
        setComparison(c)
        if (!edited.current) {
          const d = draftFromCommits(target.branch, c.commits)
          setTitle(d.title)
          setBody(d.body)
        }
      })
      .catch((e) => !cancelled && setError(errorMessage(e)))
    return () => {
      cancelled = true
    }
  }, [target, base])

  async function writeWithCopilot() {
    if (!comparison) return
    setBusy('copilot')
    const reply = await ask(() =>
      copilot.pullRequest(repo.path, comparison.mergeBase, comparison.commits),
    )
    setBusy(null)
    if (reply === null) return
    const d = splitReply(reply)
    edited.current = true
    setTitle(d.title)
    setBody(d.body)
  }

  async function create(e: React.FormEvent) {
    e.preventDefault()
    setBusy('create')
    setError(null)
    try {
      if (unpushed > 0 && !(await push())) return
      onCreated(
        await github.createPullRequest(
          repo.path,
          base,
          title.trim(),
          body,
          draft,
        ),
      )
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  const nothingToMerge = comparison?.commits.length === 0 && unpushed === 0
  const baseSelect = (
    <select
      value={base}
      onChange={(e) => setBase(e.target.value)}
      aria-label={t('pullrequests.base-branch')}
      className="rounded border border-line bg-bg px-1.5 py-0.5 font-mono text-xs text-fg outline-none focus:border-accent"
    >
      {bases.map((b) => (
        <option key={b}>{b}</option>
      ))}
    </select>
  )

  const input =
    'w-full rounded border border-line bg-bg px-2 py-1.5 outline-none focus:border-accent'

  return (
    <Dialog
      title={t('pullrequests.create-pull-request')}
      onClose={onClose}
      wide
    >
      <form onSubmit={create} className="space-y-3">
        <div className="flex flex-wrap items-center gap-1.5 text-muted">
          {fill(
            t(
              sameRepo
                ? 'pullrequests.merge-head-into-base'
                : 'pullrequests.merge-head-into-base-of-repo',
            ),
            {
              head: (
                <span className="rounded bg-hover px-1.5 font-mono text-xs text-fg">
                  {sameRepo ? '' : `${target.headRepo.split('/')[0]}:`}
                  {target.branch}
                </span>
              ),
              base: baseSelect,
              repo: target.baseRepo,
            },
          )}
        </div>
        <p className="text-xs text-muted">
          {comparison === null
            ? t('pullrequests.comparing')
            : tp('historypanel.commits', comparison.commits.length)}
          {unpushed > 0 && ` · ${tp('pullrequests.unpushed', unpushed)}`}
        </p>
        <div>
          <div className="mb-1 flex items-center justify-between text-muted">
            <label htmlFor="pr-title">{t('pullrequests.title')}</label>
            {copilotOn && (
              <button
                type="button"
                onClick={writeWithCopilot}
                disabled={!comparison || busy !== null}
                title={t('pullrequests.write-with-copilot-title')}
                className="flex items-center gap-1 rounded px-1.5 text-xs hover:bg-hover hover:text-fg disabled:opacity-40"
              >
                {busy === 'copilot' ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Sparkles className="size-3.5" />
                )}
                {t('pullrequests.write-with-copilot')}
              </button>
            )}
          </div>
          <input
            id="pr-title"
            autoFocus
            value={title}
            onChange={(e) => {
              edited.current = true
              setTitle(e.target.value)
            }}
            className={input}
          />
        </div>
        <label className="block">
          <span className="mb-1 block text-muted">
            {t('pullrequests.description')}
          </span>
          <textarea
            value={body}
            onChange={(e) => {
              edited.current = true
              setBody(e.target.value)
            }}
            rows={8}
            className={`${input} resize-y font-mono text-xs`}
          />
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={draft}
            onChange={(e) => setDraft(e.target.checked)}
            className="accent-accent"
          />
          {t('pullrequests.create-as-draft')}
        </label>
        {nothingToMerge && (
          <p className="text-muted">
            {t('pullrequests.nothing-to-merge', {
              branch: target.branch,
              base,
            })}
          </p>
        )}
        {error && <p className="text-removed select-text">{error}</p>}
        <button
          type="submit"
          disabled={busy !== null || !title.trim() || nothingToMerge}
          className="flex w-full items-center justify-center gap-2 rounded bg-accent py-2 font-medium text-on-accent hover:opacity-90 disabled:opacity-40"
        >
          {busy === 'create' && <Loader2 className="size-4 animate-spin" />}
          {unpushed > 0
            ? t('pullrequests.push-and-create')
            : t('pullrequests.create-pull-request')}
        </button>
      </form>
    </Dialog>
  )
}
