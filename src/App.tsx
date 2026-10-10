import { useEffect, useState } from 'react'
import { message, open } from '@tauri-apps/plugin-dialog'
import { Download, FolderGit2, FolderOpen, GitBranch, X } from 'lucide-react'
import {
  errorMessage,
  git,
  github,
  type Account,
  type RepoInfo,
} from './lib/git'
import RepoView from './components/RepoView'
import CloneDialog from './components/CloneDialog'
import { addRecent, readRecents, removeRecent } from './lib/prefs'

export default function App() {
  const [repo, setRepo] = useState<RepoInfo | null>(null)
  const [account, setAccount] = useState<Account | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [cloning, setCloning] = useState(false)
  const [recents, setRecents] = useState(readRecents)

  function show(info: RepoInfo) {
    setRepo(info)
    setError(null)
    setRecents(addRecent(info))
  }

  async function openPath(path: string) {
    try {
      show(await git.openRepo(path))
    } catch (e) {
      // Moved or deleted; it would only fail again.
      setRecents(removeRecent(path))
      if (repo)
        await message(errorMessage(e), {
          title: 'Could not open repository',
          kind: 'error',
        })
      else setError(errorMessage(e))
    }
  }

  async function pickRepo() {
    const path = await open({ directory: true, title: 'Open repository' })
    if (typeof path === 'string') await openPath(path)
  }

  useEffect(() => {
    // Without keychain access the user just appears signed out.
    github
      .account()
      .then(setAccount)
      .catch(() => {})
  }, [])

  // Open the repo given on the command line, or else the last one used.
  useEffect(() => {
    git
      .initialRepo()
      .then(async (fromArgs) => {
        if (fromArgs) return openPath(fromArgs)
        const last = readRecents()[0]
        if (last) setRepo(await git.openRepo(last.path).catch(() => null))
      })
      .finally(() => setLoading(false))
  }, [])

  if (loading) return null

  const cloneDialog = cloning && (
    <CloneDialog
      account={account}
      onAccountChange={setAccount}
      onClose={() => setCloning(false)}
      onCloned={(info) => {
        setCloning(false)
        show(info)
      }}
    />
  )

  if (repo)
    return (
      <>
        <RepoView
          // Remount so per-repo state (selection, diff) starts fresh.
          key={repo.path}
          repo={repo}
          account={account}
          onAccountChange={setAccount}
          onOpenOther={pickRepo}
          recents={recents}
          onOpenRecent={openPath}
          onClone={() => setCloning(true)}
        />
        {cloneDialog}
      </>
    )

  const button =
    'flex items-center gap-2 rounded-md px-4 py-2 font-medium hover:opacity-90'

  return (
    <main className="flex h-full flex-col items-center justify-center gap-6 overflow-auto p-8 text-center">
      <GitBranch className="size-12 text-accent" strokeWidth={1.5} />
      <div>
        <h1 className="text-2xl font-semibold">GitGud</h1>
        <p className="mt-1 text-muted">Open a Git repository to get started.</p>
      </div>
      <div className="flex gap-3">
        <button onClick={pickRepo} className={`${button} bg-accent text-white`}>
          <FolderOpen className="size-4" />
          Open repository
        </button>
        <button
          onClick={() => setCloning(true)}
          className={`${button} border border-line hover:bg-hover`}
        >
          <Download className="size-4" />
          Clone repository
        </button>
      </div>
      {error && <p className="max-w-md text-removed">{error}</p>}
      {recents.length > 0 && (
        <div className="w-full max-w-md text-left">
          <h2 className="mb-1 px-1 text-xs font-medium text-muted">
            Recent repositories
          </h2>
          <ul className="overflow-hidden rounded-md border border-line">
            {recents.map((r) => (
              <li
                key={r.path}
                className="group flex items-center border-b border-line last:border-b-0 hover:bg-hover"
              >
                <button
                  onClick={() => openPath(r.path)}
                  title={r.path}
                  className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2 text-left"
                >
                  <FolderGit2 className="size-4 shrink-0 text-muted" />
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{r.name}</span>
                    <span className="block truncate text-xs text-muted">
                      {r.path}
                    </span>
                  </span>
                </button>
                <button
                  onClick={() => setRecents(removeRecent(r.path))}
                  title="Remove from list"
                  className="mr-2 rounded p-1 text-muted opacity-0 group-hover:opacity-100 hover:bg-panel hover:text-fg focus:opacity-100"
                >
                  <X className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {cloneDialog}
    </main>
  )
}
