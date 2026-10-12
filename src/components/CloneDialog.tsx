import { useEffect, useMemo, useRef, useState } from 'react'
import { listen } from '@tauri-apps/api/event'
import { homeDir } from '@tauri-apps/api/path'
import { open } from '@tauri-apps/plugin-dialog'
import { Loader2, Lock, Search } from 'lucide-react'
import {
  errorMessage,
  git,
  github,
  type Account,
  type CloneProgress,
  type RemoteRepo,
  type RepoInfo,
} from '../lib/git'
import { repoNameFromUrl } from '../lib/url'
import Dialog from './Dialog'
import SignInDialog from './SignInDialog'
import GithubIcon from './GithubIcon'

const CLONE_DIR_KEY = 'gitgud.cloneDir'

interface Props {
  account: Account | null
  onAccountChange: (account: Account) => void
  onClose: () => void
  onCloned: (repo: RepoInfo) => void
}

export default function CloneDialog({
  account,
  onAccountChange,
  onClose,
  onCloned,
}: Props) {
  const [tab, setTab] = useState<'github' | 'url'>('github')
  const [url, setUrl] = useState('')
  const [name, setName] = useState('')
  const [nameEdited, setNameEdited] = useState(false)
  const [parent, setParent] = useState('')
  const [signingIn, setSigningIn] = useState(false)
  const [progress, setProgress] = useState<CloneProgress | null>(null)
  const [cloning, setCloning] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const cancelled = useRef(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let saved: string | null = null
    try {
      saved = localStorage.getItem(CLONE_DIR_KEY)
    } catch {
      // Fall back to the home directory.
    }
    if (saved) setParent(saved)
    else homeDir().then(setParent)
  }, [])

  function chooseUrl(newUrl: string, repoName?: string) {
    setUrl(newUrl)
    if (!nameEdited) setName(repoName ?? repoNameFromUrl(newUrl))
  }

  async function browse() {
    const dir = await open({ directory: true, title: 'Clone into…' })
    if (typeof dir === 'string') setParent(dir)
  }

  async function clone(e: React.FormEvent) {
    e.preventDefault()
    setCloning(true)
    setError(null)
    setProgress(null)
    cancelled.current = false
    const unlisten = await listen<CloneProgress>('clone-progress', (event) =>
      setProgress(event.payload),
    )
    try {
      const repo = await git.clone(url, parent, name.trim())
      try {
        localStorage.setItem(CLONE_DIR_KEY, parent)
      } catch {
        // Remembering the folder is only a convenience.
      }
      onCloned(repo)
    } catch (err) {
      // Cancelling is not an error worth showing.
      if (!cancelled.current) setError(errorMessage(err))
    } finally {
      unlisten()
      setCloning(false)
      setCancelling(false)
    }
  }

  async function cancel() {
    cancelled.current = true
    setCancelling(true)
    try {
      await git.cancelClone()
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  const separator = parent.includes('\\') ? '\\' : '/'
  const destination =
    parent && name.trim()
      ? `${parent.replace(/[/\\]+$/, '')}${separator}${name.trim()}`
      : ''
  const input =
    'w-full rounded border border-line bg-bg px-2 py-1.5 outline-none focus:border-accent'

  if (signingIn)
    return (
      <SignInDialog
        onClose={() => setSigningIn(false)}
        onSignedIn={(a) => {
          onAccountChange(a)
          setSigningIn(false)
        }}
      />
    )

  return (
    // Closing mid-clone would hide progress while git keeps running.
    <Dialog title="Clone repository" onClose={() => !cloning && onClose()} wide>
      <form onSubmit={clone} className="space-y-4">
        <div className="flex gap-1 rounded-md bg-bg p-1">
          {(['github', 'url'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`flex flex-1 items-center justify-center gap-2 rounded py-1 ${
                tab === t ? 'bg-hover font-medium' : 'text-muted hover:text-fg'
              }`}
            >
              {t === 'github' ? (
                <>
                  <GithubIcon className="size-3.5" /> GitHub
                </>
              ) : (
                'URL'
              )}
            </button>
          ))}
        </div>

        {tab === 'github' ? (
          account ? (
            <RepoPicker
              selectedUrl={url}
              onPick={(r) => chooseUrl(r.cloneUrl, r.name)}
            />
          ) : (
            <div className="space-y-3 py-4 text-center">
              <p className="text-muted">
                Sign in to see your GitHub repositories.
              </p>
              <button
                type="button"
                onClick={() => setSigningIn(true)}
                className="inline-flex items-center gap-2 rounded bg-accent px-4 py-1.5 font-medium text-white hover:opacity-90"
              >
                <GithubIcon className="size-4" /> Sign in to GitHub
              </button>
            </div>
          )
        ) : (
          <label className="block">
            <span className="mb-1 block text-muted">Repository URL</span>
            <input
              autoFocus
              value={url}
              onChange={(e) => chooseUrl(e.target.value)}
              placeholder="https://github.com/user/repo.git"
              className={input}
            />
          </label>
        )}

        <div className="grid grid-cols-[1fr_auto] gap-2">
          <label className="col-span-2 block">
            <span className="mb-1 block text-muted">Clone into</span>
            <div className="flex gap-2">
              <input
                value={parent}
                onChange={(e) => setParent(e.target.value)}
                className={input}
              />
              <button
                type="button"
                onClick={browse}
                className="shrink-0 rounded border border-line px-3 hover:bg-hover"
              >
                Browse…
              </button>
            </div>
          </label>
          <label className="col-span-2 block">
            <span className="mb-1 block text-muted">Folder name</span>
            <input
              value={name}
              onChange={(e) => {
                setName(e.target.value)
                setNameEdited(true)
              }}
              className={input}
            />
          </label>
        </div>
        {destination && (
          <p className="truncate text-xs text-muted" title={destination}>
            Will be cloned to <span className="font-mono">{destination}</span>
          </p>
        )}

        {cloning && (
          <div className="space-y-1">
            <div className="flex justify-between text-xs text-muted">
              <span>
                {cancelling
                  ? 'Cancelling…'
                  : (progress?.phase ?? 'Connecting…')}
              </span>
              {progress && <span>{progress.percent}%</span>}
            </div>
            <div className="flex items-center gap-2">
              <div className="h-1.5 flex-1 overflow-hidden rounded bg-bg">
                <div
                  className="h-full bg-accent transition-[width]"
                  style={{ width: `${progress?.percent ?? 0}%` }}
                />
              </div>
              <button
                type="button"
                onClick={cancel}
                disabled={cancelling}
                className="shrink-0 rounded border border-line px-2 py-0.5 text-xs hover:bg-hover disabled:opacity-40"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
        {error && (
          <pre className="font-mono text-xs whitespace-pre-wrap text-removed select-text">
            {error}
          </pre>
        )}

        <button
          type="submit"
          disabled={cloning || !url.trim() || !name.trim() || !parent}
          className="flex w-full items-center justify-center gap-2 rounded bg-accent py-2 font-medium text-white hover:opacity-90 disabled:opacity-40"
        >
          {cloning && <Loader2 className="size-4 animate-spin" />}
          Clone
        </button>
      </form>
    </Dialog>
  )
}

function RepoPicker({
  selectedUrl,
  onPick,
}: {
  selectedUrl: string
  onPick: (repo: RemoteRepo) => void
}) {
  const [repos, setRepos] = useState<RemoteRepo[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  useEffect(() => {
    github
      .repos()
      .then(setRepos)
      .catch((e) => setError(errorMessage(e)))
  }, [])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (repos ?? []).filter((r) => r.fullName.toLowerCase().includes(q))
  }, [repos, query])

  if (error) return <p className="text-removed">{error}</p>
  if (!repos)
    return (
      <div className="flex justify-center py-8 text-muted">
        <Loader2 className="size-5 animate-spin" />
      </div>
    )

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="absolute top-2 left-2 size-4 text-muted" />
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter repositories"
          className="w-full rounded border border-line bg-bg py-1.5 pr-2 pl-8 outline-none focus:border-accent"
        />
      </div>
      <ul className="h-56 overflow-auto rounded border border-line">
        {filtered.map((r) => (
          <li key={r.fullName}>
            <button
              type="button"
              onClick={() => onPick(r)}
              className={`flex w-full items-center gap-2 px-3 py-1.5 text-left ${
                selectedUrl === r.cloneUrl ? 'bg-accent/20' : 'hover:bg-hover'
              }`}
            >
              <span className="min-w-0 flex-1 truncate">
                <span className="text-muted">{r.owner.login}/</span>
                {r.name}
              </span>
              {r.private && <Lock className="size-3.5 shrink-0 text-muted" />}
            </button>
          </li>
        ))}
        {filtered.length === 0 && (
          <li className="p-4 text-center text-muted">No repositories found</li>
        )}
      </ul>
    </div>
  )
}
