import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  canBlame,
  copilot,
  errorMessage,
  git,
  github,
  isStaged,
  isUnstaged,
  type Account,
  type Branch,
  type Commit,
  type FileChange,
  type Remote,
  type RepoInfo,
  type Stash,
  type Status,
  type Undoable,
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
import BlameView, { type BlameTarget } from './BlameView'
import ConflictView from './ConflictView'
import RebaseDialog from './RebaseDialog'
import SignInDialog from './SignInDialog'
import HostsDialog from './HostsDialog'
import ReflogDialog from './ReflogDialog'
import UndoToast from './UndoToast'
import RemotesDialog from './RemotesDialog'
import PublishDialog from './PublishDialog'
import ExplainDialog from './ExplainDialog'
import { useResizable } from './Resizable'
import { useCommitActions } from './CommitActions'
import { ScrollText } from 'lucide-react'
import { useCopilot } from '../lib/copilot'
import { useCopilotPrefs } from '../lib/copilotPrefs'
import { useTranslation, type Translate } from '../i18n'
import { useSync } from './SyncActions'
import { useRepoCommands, type Tab } from './RepoCommands'
import { usePullRequests } from './PullRequests'
import { useDiffPrefs } from '../lib/diffPrefs'

/** What the right-hand pane is showing. */
export type Selection =
  | { kind: 'file'; file: FileChange; staged: boolean }
  | { kind: 'commit'; commit: Commit }
  | { kind: 'stash'; stash: Stash }

const EMPTY_HINT = (t: Translate): Record<Tab, string> => ({
  changes: t('repoview.changes-empty'),
  history: t('repoview.history-empty'),
  stashes: t('repoview.stashes-empty'),
})

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
  const { t: tx } = useTranslation()
  const [tab, setTab] = useState<Tab>('changes')
  const [status, setStatus] = useState<Status | null>(null)
  const [branches, setBranches] = useState<Branch[]>([])
  const [commits, setCommits] = useState<Commit[]>([])
  const [remotes, setRemotes] = useState<Remote[]>([])
  const [undoable, setUndoable] = useState<Undoable | null>(null)
  const [remoteBranches, setRemoteBranches] = useState<string[]>([])
  const [stashes, setStashes] = useState<Stash[]>([])
  const [dialog, setDialog] = useState<
    'signIn' | 'hosts' | 'publish' | 'stash' | 'remotes' | 'reflog' | null
  >(null)
  const [rebaseFrom, setRebaseFrom] = useState<Commit | null>(null)
  const [selection, setSelection] = useState<Selection | null>(null)
  /** Covers the right-hand pane until something else is picked. */
  const [blame, setBlame] = useState<BlameTarget | null>(null)
  const [reveal, setReveal] = useState<{ hash: string } | null>(null)
  const [historyFilter, setHistoryFilter] = useState<HistoryFilter | null>(null)
  const [filtered, setFiltered] = useState<Commit[] | null>(null)
  const [logLimit, setLogLimit] = useState(HISTORY_PAGE)
  const [diff, setDiff] = useState('')
  const { ignoreWhitespace } = useDiffPrefs()
  const [focusSearch, setFocusSearch] = useState(0)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const [s, b, c, st, r, rb, u] = await Promise.all([
        git.status(repo.path),
        git.branches(repo.path),
        git.log(repo.path, logLimit),
        git.stashes(repo.path),
        git.remotes(repo.path),
        git.remoteBranches(repo.path),
        git.undoAvailable(repo.path),
      ])
      setStatus(s)
      setBranches(b)
      setCommits(c)
      setStashes(st)
      setRemotes(r)
      setRemoteBranches(rb)
      setUndoable(u)
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

  const blameOnDisk = useCallback(
    (path: string) => setBlame({ path, rev: null }),
    [],
  )
  useEffect(() => setBlame(null), [selection])

  /** Selects a commit in History, however old it is. */
  async function showCommit(hash: string) {
    try {
      const loaded = commits.find((c) => c.hash === hash)
      // Others can mention the hash in their message, so look for it.
      const commit =
        loaded ??
        (await git.searchLog(repo.path, hash)).find((c) => c.hash === hash)
      if (!commit) throw tx('repoview.commit-not-found', { hash })
      setTab('history')
      // Not scrolled far enough for the list to have it: list only that one.
      changeFilter(loaded ? null : { kind: 'search', query: hash })
      setReveal({ hash })
      setSelection({ kind: 'commit', commit })
    } catch (e) {
      setError(errorMessage(e))
    }
  }

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
        return git.showCommit(
          repo.path,
          selection.commit.hash,
          ignoreWhitespace,
        )
      if (selection.kind === 'stash')
        return git.stashShow(repo.path, selection.stash.index, ignoreWhitespace)
      const { file, staged } = selection
      // Staging some lines of an untracked file makes it tracked, so ask the
      // latest status rather than the selection, which was taken before.
      const untracked =
        status?.files.find((f) => f.path === file.path)?.untracked ??
        file.untracked
      return git.diff(repo.path, file.path, staged, untracked, ignoreWhitespace)
    }
    load()
      .then((d) => !cancelled && setDiff(d))
      .catch(
        (e) =>
          !cancelled &&
          setDiff(`${tx('repoview.diff-error')}\n${errorMessage(e)}`),
      )
    return () => {
      cancelled = true
    }
  }, [repo.path, selection, status, ignoreWhitespace])

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

  // With nothing to commit, History is more useful than an empty list. Only
  // when the repository opens or the last change goes away, so Changes can
  // still be opened by hand, e.g. to amend.
  const dirty = useRef<boolean | null>(null)
  useEffect(() => {
    if (!status) return
    const before = dirty.current
    dirty.current = status.files.length > 0
    if (dirty.current || before === false) return
    if (status.merging || status.rebasing || commits.length === 0) return
    setTab((t) => (t === 'changes' ? 'history' : t))
  }, [status, commits])

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

  const openSignIn = useCallback(() => setDialog('signIn'), [])
  const ai = useCopilot(setError, account !== null, openSignIn)
  const copilotOn = useCopilotPrefs()
  const suggestBranchName = copilotOn.branchName
    ? (description: string) =>
        ai.run(() => copilot.branchName(repo.path, description))
    : undefined
  const commitActions = useCommitActions(
    repo.path,
    status,
    remotes,
    act,
    suggestBranchName,
  )
  const [answer, setAnswer] = useState<{
    title: string
    text: string | null
  } | null>(null)

  /** Shows a Copilot answer in a dialog; closes again if it fails. */
  const showAnswer = useCallback(
    async (title: string, ask: () => Promise<string>) => {
      setAnswer({ title, text: null })
      const text = await ai.run(ask)
      setAnswer((shown) =>
        shown?.title !== title ? shown : text === null ? null : { title, text },
      )
    },
    [ai.run],
  )

  const explain = (title: string, load: () => Promise<string>) =>
    showAnswer(tx('explaindialog.explain-title', { title }), async () =>
      copilot.explain(await load()),
    )

  const undo = (id: number) => act('undo', () => git.undo(repo.path, id))

  const signOut = () =>
    act('signOut', async () => {
      await github.signOut()
      onAccountChange(null)
    })
  const sync = useSync(repo, status, remotes, act, () =>
    setDialog(account ? 'publish' : 'signIn'),
  )
  const showTab = (t: Tab) => {
    setTab(t)
    setSelection(null)
    setBlame(null)
    setReveal(null)
    setFocusSearch(0)
  }
  const pullRequests = usePullRequests({
    repo,
    status,
    signedIn: account !== null,
    onSignIn: openSignIn,
    push: () => act('push', () => git.push(repo.path)),
    ask: ai.run,
  })
  const palette = useRepoCommands({
    repo,
    suggestBranchName,
    status,
    branches,
    remoteBranches,
    recents,
    signedIn: account !== null,
    sync,
    busy: busy !== null,
    act,
    showTab,
    searchHistory: () => {
      if (tab !== 'history') setSelection(null)
      setTab('history')
      if (historyFilter?.kind === 'file') changeFilter(null)
      setFocusSearch((n) => n + 1)
    },
    onOpenOther,
    onOpenRecent,
    onClone,
    onStash: () => setDialog('stash'),
    onSignIn: openSignIn,
    onSignOut: signOut,
    onManageHosts: () => setDialog('hosts'),
    onManageRemotes: () => setDialog('remotes'),
    undoable,
    onUndo: undo,
    onReflog: () => setDialog('reflog'),
    extra: [
      ...pullRequests.commands,
      ...(copilotOn.releaseNotes
        ? [
            {
              id: 'releaseNotes',
              group: tx('repocommands.group-repository'),
              label: tx('repoview.draft-release-notes-since-the-last-tag'),
              keywords: 'copilot changelog summary tag',
              icon: ScrollText,
              run: () =>
                showAnswer(
                  tx('repoview.release-notes-since-the-last-tag'),
                  () => copilot.releaseNotes(repo.path, null, null),
                ),
            },
          ]
        : []),
    ],
  })

  return (
    <div className="flex h-full flex-col">
      {palette.ui}
      {pullRequests.dialog}
      {commitActions.dialogs}
      {ai.dialog}
      {answer && !ai.dialog && (
        <ExplainDialog
          title={answer.title}
          explanation={answer.text}
          onClose={() => setAnswer(null)}
        />
      )}
      <Toolbar
        repo={repo}
        status={status}
        branches={branches}
        remoteBranches={remoteBranches}
        account={account}
        busy={busy}
        onOpenOther={onOpenOther}
        recents={recents}
        onOpenRecent={onOpenRecent}
        onClone={onClone}
        onSignIn={() => setDialog('signIn')}
        onSignOut={signOut}
        onManageHosts={() => setDialog('hosts')}
        onManageRemotes={() => setDialog('remotes')}
        sync={sync}
        onPalette={palette.openPalette}
        pullRequest={pullRequests.button}
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
      <UndoToast undoable={undoable} disabled={busy !== null} onUndo={undo} />
      {dialog === 'reflog' && (
        <ReflogDialog
          repo={repo}
          branches={branches}
          onShow={showCommit}
          onCreateBranch={commitActions.actions.createBranch}
          onReset={commitActions.actions.reset}
          onRecover={(hash) =>
            act('stash', () => git.recoverStash(repo.path, hash))
          }
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'remotes' && (
        <RemotesDialog
          repo={repo}
          remotes={remotes}
          signedIn={account !== null}
          onChanged={refresh}
          onClose={() => setDialog(null)}
        />
      )}
      {rebaseFrom && (
        <RebaseDialog
          repo={repo}
          from={rebaseFrom}
          onClose={() => setRebaseFrom(null)}
          act={act}
          suggestSquashMessage={
            copilotOn.squashMessage
              ? (hashes) =>
                  ai.run(() => copilot.squashMessage(repo.path, hashes))
              : undefined
          }
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
                onClick={() => showTab(t)}
                className={`flex-1 py-2 font-medium ${
                  tab === t
                    ? 'border-b-2 border-accent text-fg'
                    : 'text-muted hover:text-fg'
                }`}
              >
                {tx(`repoview.tab-${t}`)}
                {t === 'changes' && <Count n={status?.files.length ?? 0} />}
                {t === 'stashes' && <Count n={stashes.length} />}
              </button>
            ))}
          </div>

          <ChangesPanel
            repo={repo}
            hidden={tab !== 'changes' || (!status && !error)}
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
            onBlame={blameOnDisk}
            onReview={
              copilotOn.review
                ? () =>
                    showAnswer(tx('repoview.review-of-staged-changes'), () =>
                      copilot.review(repo.path),
                    )
                : undefined
            }
            onGenerateMessage={
              copilotOn.commitMessage
                ? () => ai.run(() => copilot.commitMessage(repo.path))
                : undefined
            }
            act={act}
          />
          {tab === 'changes' ? null : tab === 'history' ? (
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
              focusSearch={focusSearch}
              reveal={reveal}
              onReleaseNotes={
                copilotOn.releaseNotes
                  ? (from, to) =>
                      showAnswer(
                        to
                          ? tx('repoview.changes-between', {
                              from: from.shortHash,
                              to: to.shortHash,
                            })
                          : tx('repoview.release-notes-since', {
                              name:
                                from.refs.find((r) => r.kind === 'tag')?.name ??
                                from.shortHash,
                            }),
                        () =>
                          copilot.releaseNotes(
                            repo.path,
                            from.hash,
                            to?.hash ?? null,
                          ),
                      )
                  : undefined
              }
              onExplain={
                copilotOn.explain
                  ? (c) =>
                      explain(c.shortHash, () =>
                        git.showCommit(repo.path, c.hash),
                      )
                  : undefined
              }
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

        <section className="isolate flex min-w-0 flex-1 flex-col overflow-hidden">
          {blame ? (
            <BlameView
              repo={repo.path}
              target={blame}
              version={status}
              onShowCommit={showCommit}
              onExplain={
                copilotOn.explain
                  ? (hash) =>
                      explain(hash.slice(0, 7), () =>
                        git.showCommit(repo.path, hash),
                      )
                  : undefined
              }
              onClose={() => setBlame(null)}
            />
          ) : selection?.kind === 'file' && conflictedSelection ? (
            <div className="min-h-0 flex-1 overflow-auto">
              <ConflictView
                repo={repo}
                file={conflictedSelection}
                version={status}
                act={act}
                onAsk={
                  copilotOn.conflicts
                    ? (index) =>
                        ai.run(() =>
                          copilot.resolve(
                            repo.path,
                            conflictedSelection.path,
                            index,
                          ),
                        )
                    : undefined
                }
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
              onBlame={(path) => setBlame({ path, rev: selection.commit.hash })}
              onExplainFile={
                copilotOn.explain
                  ? (path, fileDiff) => explain(path, async () => fileDiff)
                  : undefined
              }
              header={
                <CommitHeader
                  commit={selection.commit}
                  message={parts.preamble}
                  onExplain={
                    copilotOn.explain
                      ? () =>
                          explain(selection.commit.shortHash, async () => diff)
                      : undefined
                  }
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
                onBlame={canBlame(selection.file) ? blameOnDisk : undefined}
                additions={fileStats.additions}
                deletions={fileStats.deletions}
                onExplain={
                  diff && copilotOn.explain
                    ? () => explain(selection.file.path, async () => diff)
                    : undefined
                }
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
              {EMPTY_HINT(tx)[tab]}
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
            {tx('repoview.dismiss')}
          </button>
        </div>
      )}
    </div>
  )
}
