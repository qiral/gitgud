import { useCallback, useEffect, useMemo, useState } from 'react'
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
import { splitDiff } from '../lib/diff'
import Toolbar from './Toolbar'
import ChangesPanel from './ChangesPanel'
import HistoryPanel, { type HistoryFilter } from './HistoryPanel'
import StashPanel from './StashPanel'
import StashDialog from './StashDialog'
import DiffView from './DiffView'
import PatchView from './PatchView'
import FileHeader from './FileHeader'
import { CommitHeader, StashHeader } from './CommitHeader'
import ConflictView from './ConflictView'
import RebaseDialog from './RebaseDialog'
import SignInDialog from './SignInDialog'
import HostsDialog from './HostsDialog'
import PublishDialog from './PublishDialog'
import { useResizable } from './Resizable'
import { useCommitActions } from './CommitActions'

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

/** History loads this many commits at first, and this many more each time
 *  the list is scrolled near its end. */
const HISTORY_PAGE = 300

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
  const [dialog, setDialog] = useState<
    'signIn' | 'hosts' | 'publish' | 'stash' | null
  >(null)
  const [rebaseFrom, setRebaseFrom] = useState<Commit | null>(null)
  const [selection, setSelection] = useState<Selection | null>(null)
  const [historyFilter, setHistoryFilter] = useState<HistoryFilter | null>(null)
  const [filtered, setFiltered] = useState<Commit[] | null>(null)
  const [logLimit, setLogLimit] = useState(HISTORY_PAGE)
  const [diff, setDiff] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const [s, b, c, o, st] = await Promise.all([
        git.status(repo.path),
        git.branches(repo.path),
        git.log(repo.path, logLimit),
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
  }, [repo.path, logLimit])

  // Only asks for more once the last page came back full, i.e. there may be
  // more; until then the commits are still shorter than the limit.
  const loadMoreHistory = useCallback(() => {
    if (commits.length >= logLimit) setLogLimit((l) => l + HISTORY_PAGE)
  }, [commits.length, logLimit])

  // Runs the history search or file history; again whenever the log
  // reloads, so new commits show up in it too.
  useEffect(() => {
    if (!historyFilter) return
    let cancelled = false
    const timer = setTimeout(
      () => {
        const load =
          historyFilter.kind === 'search'
            ? git.searchLog(repo.path, historyFilter.query)
            : git.fileLog(repo.path, historyFilter.path)
        load
          .then((c) => !cancelled && setFiltered(c))
          .catch((e) => {
            if (cancelled) return
            setFiltered([])
            setError(errorMessage(e))
          })
      },
      // Wait for a pause in typing before searching.
      historyFilter.kind === 'search' ? 250 : 0,
    )
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [repo.path, historyFilter, commits])

  /** Results of the last filter stay up while a new one loads, except
   *  when it's a different kind of filter. */
  const changeFilter = useCallback((f: HistoryFilter | null) => {
    setHistoryFilter((old) => {
      if (old?.kind !== f?.kind || f?.kind === 'file') setFiltered(null)
      return f
    })
    setSelection(null)
  }, [])

  const showFileHistory = useCallback(
    (path: string) => {
      setTab('history')
      changeFilter({ kind: 'file', path })
    },
    [changeFilter],
  )

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
      // Staging some lines of an untracked file makes it tracked, so ask the
      // latest status rather than the selection, which was taken before.
      const untracked =
        status?.files.find((f) => f.path === file.path)?.untracked ??
        file.untracked
      return git.diff(repo.path, file.path, staged, untracked)
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

  // The graph and branch labels need more room than file lists, so History
  // starts wider and remembers its own width.
  const sidebar = useResizable(
    tab === 'history'
      ? { key: 'sidebar.history', initial: 448, min: 260, max: 1000 }
      : { key: 'sidebar', initial: 320, min: 220, max: 800 },
  )

  const parts = useMemo(() => splitDiff(diff), [diff])
  const fileStats = {
    additions: parts.files.reduce((n, f) => n + f.additions, 0),
    deletions: parts.files.reduce((n, f) => n + f.deletions, 0),
  }

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

  const commitActions = useCommitActions(repo.path, status, act)

  return (
    <div className="flex h-full flex-col">
      {commitActions.dialogs}
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
        onManageHosts={() => setDialog('hosts')}
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
      {dialog === 'hosts' && <HostsDialog onClose={() => setDialog(null)} />}
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
          style={{ width: sidebar.width }}
          className="relative flex shrink-0 flex-col border-r border-line bg-panel"
        >
          {sidebar.handle}
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
              operation={status?.operation ?? null}
              rebasing={status?.rebasing ?? null}
              hasCommits={commits.length > 0}
              selection={selection}
              onSelect={setSelection}
              busy={busy !== null}
              onStash={() => setDialog('stash')}
              onFileHistory={showFileHistory}
              act={act}
            />
          ) : tab === 'history' ? (
            <HistoryPanel
              repoPath={repo.path}
              commits={commits}
              selection={selection}
              onSelect={setSelection}
              onLoadMore={loadMoreHistory}
              actions={commitActions.actions}
              filter={historyFilter}
              onFilter={changeFilter}
              filtered={filtered}
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

        <section className="flex min-w-0 flex-1 flex-col overflow-hidden">
          {selection?.kind === 'file' && conflictedSelection ? (
            <div className="min-h-0 flex-1 overflow-auto">
              <ConflictView
                repo={repo}
                file={conflictedSelection}
                version={status}
                act={act}
              />
            </div>
          ) : selection?.kind === 'commit' ? (
            <PatchView
              repo={repo.path}
              patch={diff}
              focusPath={
                historyFilter?.kind === 'file' ? historyFilter.path : undefined
              }
              onFileHistory={showFileHistory}
              header={
                <CommitHeader
                  commit={selection.commit}
                  message={parts.preamble}
                />
              }
            />
          ) : selection?.kind === 'stash' ? (
            <PatchView
              repo={repo.path}
              patch={diff}
              header={<StashHeader stash={selection.stash} />}
            />
          ) : selection ? (
            <>
              <FileHeader
                repo={repo.path}
                path={selection.file.path}
                onHistory={
                  selection.file.untracked ? undefined : showFileHistory
                }
                additions={fileStats.additions}
                deletions={fileStats.deletions}
                exists={
                  selection.file.worktree !== 'D' &&
                  selection.file.index !== 'D'
                }
              />
              <div className="min-h-0 flex-1 overflow-auto">
                <DiffView
                  diff={diff}
                  actions={
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
              </div>
            </>
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
