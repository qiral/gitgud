import { useCallback, useEffect, useState } from 'react'
import {
  errorMessage,
  git,
  github,
  isStaged,
  isUnstaged,
  type Account,
  type Branch,
  type Commit,
  type FileChange,
  type RepoInfo,
  type Stash,
  type Status,
} from '../lib/git'
import Toolbar from './Toolbar'
import ChangesPanel from './ChangesPanel'
import HistoryPanel from './HistoryPanel'
import StashPanel from './StashPanel'
import StashDialog from './StashDialog'
import DiffView from './DiffView'
import ConflictView from './ConflictView'
import RebaseDialog from './RebaseDialog'
import SignInDialog from './SignInDialog'
import PublishDialog from './PublishDialog'

type Tab = 'changes' | 'history' | 'stashes'

/** What the right-hand pane is showing. */
export type Selection =
  | { kind: 'file'; file: FileChange; staged: boolean }
  | { kind: 'commit'; commit: Commit }
  | { kind: 'stash'; stash: Stash }

const EMPTY_HINT: Record<Tab, string> = {
  changes: 'Select a file to see its changes',
  history: 'Select a commit to see what changed',
  stashes: 'Select a stash to see what it contains',
}

function Count({ n }: { n: number }) {
  if (n === 0) return null
  return (
    <span className="ml-1.5 rounded-full bg-hover px-1.5 text-xs">{n}</span>
  )
}

interface Props {
  repo: RepoInfo
  account: Account | null
  onAccountChange: (account: Account | null) => void
  onOpenOther: () => void
  recents: RepoInfo[]
  onOpenRecent: (path: string) => void
  onClone: () => void
}

export default function RepoView({
  repo,
  account,
  onAccountChange,
  onOpenOther,
  recents,
  onOpenRecent,
  onClone,
}: Props) {
  const [tab, setTab] = useState<Tab>('changes')
  const [status, setStatus] = useState<Status | null>(null)
  const [branches, setBranches] = useState<Branch[]>([])
  const [commits, setCommits] = useState<Commit[]>([])
  const [originUrl, setOriginUrl] = useState<string | null>(null)
  const [stashes, setStashes] = useState<Stash[]>([])
  const [dialog, setDialog] = useState<'signIn' | 'publish' | 'stash' | null>(
    null,
  )
  const [rebaseFrom, setRebaseFrom] = useState<Commit | null>(null)
  const [selection, setSelection] = useState<Selection | null>(null)
  const [diff, setDiff] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const [s, b, c, o, st] = await Promise.all([
        git.status(repo.path),
        git.branches(repo.path),
        git.log(repo.path),
        git.originUrl(repo.path),
        git.stashes(repo.path),
      ])
      setStatus(s)
      setBranches(b)
      setCommits(c)
      setOriginUrl(o)
      setStashes(st)
    } catch (e) {
      setError(errorMessage(e))
    }
  }, [repo.path])

  // Pick up changes made outside the app (editor saves, terminal commands).
  useEffect(() => {
    refresh()
    window.addEventListener('focus', refresh)
    return () => window.removeEventListener('focus', refresh)
  }, [refresh])

  // Drop the selection when the file is no longer in that list.
  useEffect(() => {
    if (selection?.kind !== 'file' || !status) return
    const { file, staged } = selection
    const stillThere = status.files.some(
      (f) => f.path === file.path && (staged ? isStaged(f) : isUnstaged(f)),
    )
    if (!stillThere) setSelection(null)
  }, [status, selection])

  // Indexes shift after a pop or drop, so match on the timestamp too.
  useEffect(() => {
    if (selection?.kind !== 'stash') return
    const { index, time } = selection.stash
    if (!stashes.some((s) => s.index === index && s.time === time))
      setSelection(null)
  }, [stashes, selection])

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      if (!selection) return ''
      if (selection.kind === 'commit')
        return git.showCommit(repo.path, selection.commit.hash)
      if (selection.kind === 'stash')
        return git.stashShow(repo.path, selection.stash.index)
      const { file, staged } = selection
      return git.diff(repo.path, file.path, staged, file.untracked)
    }
    load()
      .then((d) => !cancelled && setDiff(d))
      .catch(
        (e) =>
          !cancelled && setDiff(`Could not load diff:\n${errorMessage(e)}`),
      )
    return () => {
      cancelled = true
    }
  }, [repo.path, selection, status])

  // Use the file's current state; it may have become (un)conflicted.
  const conflictedSelection =
    selection?.kind === 'file'
      ? (status?.files.find(
          (f) => f.path === selection.file.path && f.conflicted,
        ) ?? null)
      : null

  // A merge or rebase that stops with conflicts needs the Changes tab.
  const stopped = status?.merging ?? status?.rebasing?.step ?? null
  useEffect(() => {
    if (stopped !== null) setTab('changes')
  }, [stopped])

  /** Runs a git action, shows its errors, and refreshes afterwards. */
  const act = useCallback(
    async (label: string, action: () => Promise<unknown>) => {
      setBusy(label)
      setError(null)
      try {
        await action()
        return true
      } catch (e) {
        setError(errorMessage(e))
        return false
      } finally {
        setBusy(null)
        await refresh()
      }
    },
    [refresh],
  )

  return (
    <div className="flex h-full flex-col">
      <Toolbar
        repo={repo}
        status={status}
        branches={branches}
        originUrl={originUrl}
        account={account}
        busy={busy}
        onOpenOther={onOpenOther}
        recents={recents}
        onOpenRecent={onOpenRecent}
        onClone={onClone}
        onSignIn={() => setDialog('signIn')}
        onSignOut={() =>
          act('signOut', async () => {
            await github.signOut()
            onAccountChange(null)
          })
        }
        onPublish={() => setDialog(account ? 'publish' : 'signIn')}
        act={act}
      />

      {dialog === 'signIn' && (
        <SignInDialog
          onClose={() => setDialog(null)}
          onSignedIn={(a) => {
            onAccountChange(a)
            setDialog(null)
          }}
        />
      )}
      {rebaseFrom && (
        <RebaseDialog
          repo={repo}
          from={rebaseFrom}
          onClose={() => setRebaseFrom(null)}
          act={act}
        />
      )}
      {dialog === 'stash' && (
        <StashDialog repo={repo} onClose={() => setDialog(null)} act={act} />
      )}
      {dialog === 'publish' && (
        <PublishDialog
          repo={repo}
          onClose={() => setDialog(null)}
          onPublished={() => {
            setDialog(null)
            refresh()
          }}
        />
      )}

      <div className="flex min-h-0 flex-1">
        <aside
          className={`flex shrink-0 flex-col border-r border-line bg-panel ${
            // The graph and branch labels need more room than file lists.
            tab === 'history' ? 'w-[28rem]' : 'w-80'
          }`}
        >
          <div className="flex border-b border-line">
            {(['changes', 'history', 'stashes'] as const).map((t) => (
              <button
                key={t}
                onClick={() => {
                  setTab(t)
                  setSelection(null)
                }}
                className={`flex-1 py-2 font-medium capitalize ${
                  tab === t
                    ? 'border-b-2 border-accent text-fg'
                    : 'text-muted hover:text-fg'
                }`}
              >
                {t}
                {t === 'changes' && <Count n={status?.files.length ?? 0} />}
                {t === 'stashes' && <Count n={stashes.length} />}
              </button>
            ))}
          </div>

          {tab === 'changes' ? (
            <ChangesPanel
              repo={repo}
              files={status?.files ?? []}
              merging={status?.merging ?? null}
              rebasing={status?.rebasing ?? null}
              selection={selection}
              onSelect={setSelection}
              busy={busy !== null}
              onStash={() => setDialog('stash')}
              act={act}
            />
          ) : tab === 'history' ? (
            <HistoryPanel
              commits={commits}
              selection={selection}
              onSelect={setSelection}
              onRebaseFrom={
                status?.branch && !status.merging && !status.rebasing
                  ? setRebaseFrom
                  : undefined
              }
            />
          ) : (
            <StashPanel
              repo={repo}
              stashes={stashes}
              selection={selection}
              onSelect={setSelection}
              busy={busy !== null}
              act={act}
            />
          )}
        </aside>

        <section className="min-w-0 flex-1 overflow-auto">
          {selection?.kind === 'file' && conflictedSelection ? (
            <ConflictView
              repo={repo}
              file={conflictedSelection}
              version={status}
              act={act}
            />
          ) : selection ? (
            <DiffView
              diff={diff}
              actions={
                selection.kind === 'file' &&
                !selection.file.untracked &&
                !selection.file.conflicted
                  ? {
                      staged: selection.staged,
                      onApply: (lines, action) =>
                        act('lines', () =>
                          git.applyLines(repo.path, diff, lines, action),
                        ),
                    }
                  : undefined
              }
            />
          ) : (
            <div className="flex h-full items-center justify-center text-muted">
              {EMPTY_HINT[tab]}
            </div>
          )}
        </section>
      </div>

      {error && (
        <div className="flex items-start gap-3 border-t border-line bg-removed-bg px-4 py-2 text-removed">
          <pre className="flex-1 font-mono text-xs whitespace-pre-wrap select-text">
            {error}
          </pre>
          <button onClick={() => setError(null)} className="hover:underline">
            Dismiss
          </button>
        </div>
      )}
    </div>
  )
}
