// Typed wrappers around the Rust commands in src-tauri/src/lib.rs.
import { invoke } from '@tauri-apps/api/core'

export interface RepoInfo {
  path: string
  name: string
}

export type IgnoreKind = 'file' | 'extension' | 'folder'

export interface FileChange {
  path: string
  origPath: string | null
  index: string
  worktree: string
  untracked: boolean
  conflicted: boolean
}

export interface Status {
  branch: string | null
  upstream: string | null
  ahead: number
  behind: number
  files: FileChange[]
  /** While a merge, cherry-pick or revert is in progress: what it is,
   *  e.g. "Merge branch 'x'". */
  merging: string | null
  operation: Operation | null
  /** While a rebase is stopped, e.g. for conflicts. */
  rebasing: {
    step: number
    total: number
    branch: string
    /** True for a history edit, false for e.g. a pull with rebase. */
    editingHistory: boolean
  } | null
}

export interface LastCommit {
  message: string
  /** A remote branch has it, so amending it needs a force push. */
  pushed: boolean
}

export type Operation = 'merge' | 'cherryPick' | 'revert'

export type ResetMode = 'soft' | 'mixed' | 'hard'

export interface Branch {
  name: string
  current: boolean
  upstream: string | null
}

export interface RefLabel {
  name: string
  kind: 'head' | 'branch' | 'remote' | 'tag'
}

/** One row of the history graph; see src-tauri/src/graph.rs. */
export interface GraphRow {
  lane: number
  color: number
  width: number
  /** y is 0 (row top), 1 (commit dot) or 2 (row bottom); x is a lane index. */
  segments: { x1: number; y1: number; x2: number; y2: number; color: number }[]
}

export interface Commit {
  hash: string
  shortHash: string
  author: string
  email: string
  time: number
  subject: string
  parents: string[]
  refs: RefLabel[]
  graph: GraphRow
}

export interface Remote {
  name: string
  url: string
  /** Set when pushes go somewhere other than `url`. */
  pushUrl: string | null
}

/** The repository a fork was made from. */
export interface Parent {
  /** owner/repo */
  fullName: string
  url: string
}

/** Where blamed lines come from; see src-tauri/src/blame.rs. */
export interface BlameOrigin {
  /** Null for lines that aren't committed yet. */
  hash: string | null
  author: string
  time: number
  subject: string
  path: string
  /** The parent commit and the file there; null where the file began. */
  previous: { hash: string; path: string } | null
}

export interface Blame {
  origins: BlameOrigin[]
  /** `origin` indexes `origins`; `original` is the line's number there. */
  lines: { origin: number; original: number; text: string }[]
}

export type UndoKind =
  | 'commit'
  | 'amend'
  | 'merge'
  | 'cherryPick'
  | 'revert'
  | 'rebase'
  | 'reset'
  | 'deleteBranch'
  | 'dropStash'
  | 'discard'

/** What can be undone right now; see src-tauri/src/undo.rs. */
export interface Undoable {
  /** Grows with every action. */
  id: number
  kind: UndoKind
}

/** A place HEAD or a branch has been, or a deleted stash. */
export interface ReflogEntry {
  hash: string
  shortHash: string
  time: number
  /** What moved it there, e.g. "reset: moving to HEAD~1". */
  action: string
  subject: string
}

export interface Stash {
  index: number
  message: string
  branch: string | null
  time: number
}

export interface Account {
  login: string
  name: string | null
  avatarUrl: string
}

export interface DeviceCode {
  deviceCode: string
  userCode: string
  verificationUri: string
  expiresIn: number
  interval: number
}

export type PollResult =
  | { state: 'pending'; interval: number }
  | { state: 'done'; account: Account }
  | { state: 'failed'; message: string }

export interface CreatedRepo {
  fullName: string
  cloneUrl: string
  htmlUrl: string
}

export interface RemoteRepo {
  fullName: string
  name: string
  owner: { login: string }
  description: string | null
  private: boolean
  fork: boolean
  cloneUrl: string
  updatedAt: string
}

export type HostKind = 'gitlab' | 'gitea' | 'other'

/** A non-GitHub Git host signed in with a personal access token. */
export interface Host {
  /** Normalized, e.g. "https://gitlab.com/". */
  url: string
  kind: HostKind
  login: string
}

export const hosts = {
  list: () => invoke<Host[]>('hosts_list'),
  add: (url: string, kind: HostKind, username: string, token: string) =>
    invoke<Host>('host_add', { url, kind, username, token }),
  remove: (url: string) => invoke<void>('host_remove', { url }),
}

export interface CloneProgress {
  phase: string
  percent: number
}

/** Error text when the Copilot CLI isn't installed; see src-tauri/src/copilot.rs. */
export const COPILOT_MISSING = 'Copilot CLI not installed'

export interface PullRequest {
  number: number
  title: string
  state: 'open' | 'closed' | 'merged'
  draft: boolean
  url: string
}

/** Where a pull request for the current branch goes; see src-tauri/src/pulls.rs. */
export interface PullTarget {
  /** owner/repo the pull request is opened in (a fork's parent). */
  baseRepo: string
  /** owner/repo the branch was pushed to. */
  headRepo: string
  /** The branch's name on the remote. */
  branch: string
  defaultBase: string
  /** The newest pull request from this branch, open or not. */
  existing: PullRequest | null
}

export interface Comparison {
  mergeBase: string
  /** Full commit messages, oldest first. */
  commits: string[]
}

export const copilot = {
  /** Downloads the CLI, emitting `copilot-progress` events. */
  install: () => invoke<void>('copilot_install'),
  commitMessage: (repo: string) =>
    invoke<string>('copilot_commit_message', { repo }),
  explain: (diff: string) => invoke<string>('copilot_explain', { diff }),
  /** A pull request title, a blank line, then its description. */
  pullRequest: (repo: string, mergeBase: string, commits: string[]) =>
    invoke<string>('copilot_pull_request', { repo, mergeBase, commits }),
  /** Merged code for the `index`-th conflict block of `path`. */
  resolve: (repo: string, path: string, index: number) =>
    invoke<string>('copilot_resolve', { repo, path, index }),
}

export const github = {
  repos: () => invoke<RemoteRepo[]>('github_repos'),
  /** Null when the current branch has no upstream on github.com. */
  pullTarget: (repo: string) =>
    invoke<PullTarget | null>('github_pull_target', { repo }),
  branches: (baseRepo: string) =>
    invoke<string[]>('github_branches', { baseRepo }),
  compare: (baseRepo: string, base: string, headRepo: string, branch: string) =>
    invoke<Comparison>('github_compare', { baseRepo, base, headRepo, branch }),
  createPullRequest: (
    repo: string,
    base: string,
    title: string,
    body: string,
    draft: boolean,
  ) =>
    invoke<PullRequest>('github_create_pull_request', {
      repo,
      base,
      title,
      body,
      draft,
    }),
  /** Null unless `origin` is a fork whose parent isn't a remote yet. */
  parent: (repo: string) => invoke<Parent | null>('github_parent', { repo }),
  account: () => invoke<Account | null>('github_account'),
  startSignIn: () => invoke<DeviceCode>('github_start_sign_in'),
  pollSignIn: (deviceCode: string, interval: number) =>
    invoke<PollResult>('github_poll_sign_in', { deviceCode, interval }),
  signOut: () => invoke<void>('github_sign_out'),
  publish: (
    repo: string,
    name: string,
    description: string,
    isPrivate: boolean,
  ) =>
    invoke<CreatedRepo>('publish_to_github', {
      repo,
      name,
      description,
      private: isPrivate,
    }),
}

/** A file with conflict markers, split into plain text and conflict blocks. */
export type ConflictPart =
  | { kind: 'text'; lines: string[] }
  | {
      kind: 'conflict'
      oursLabel: string
      ours: string[]
      base: string[] | null
      theirsLabel: string
      theirs: string[]
    }

export interface PlanCommit {
  hash: string
  shortHash: string
  subject: string
  message: string
}

export interface RebasePlan {
  /** Oldest first, the order git replays them in. */
  commits: PlanCommit[]
  /** Some commits are already pushed, so rewriting needs a force push. */
  pushed: boolean
}

export type PullMode = 'merge' | 'rebase'

export type RebaseAction = 'pick' | 'reword' | 'squash' | 'fixup' | 'drop'

export interface TodoItem {
  hash: string
  action: RebaseAction
  message?: string
}

export type LineAction = 'stage' | 'unstage' | 'discard'

export const git = {
  initialRepo: () => invoke<string | null>('initial_repo'),
  openRepo: (path: string) => invoke<RepoInfo>('open_repo', { path }),
  status: (repo: string) => invoke<Status>('status', { repo }),
  stage: (repo: string, paths: string[]) =>
    invoke<void>('stage', { repo, paths }),
  unstage: (repo: string, paths: string[]) =>
    invoke<void>('unstage', { repo, paths }),
  discard: (repo: string, paths: string[]) =>
    invoke<void>('discard', { repo, paths }),
  /** Adds an untracked file, its extension or its folder to .gitignore. */
  ignore: (repo: string, path: string, kind: IgnoreKind) =>
    invoke<void>('ignore', { repo, path, kind }),
  /** Applies only some lines of `diff`; `lines` index into diff.split('\n'). */
  applyLines: (
    repo: string,
    diff: string,
    lines: number[],
    action: LineAction,
  ) => invoke<void>('apply_lines', { repo, diff, lines, action }),
  commit: (repo: string, message: string) =>
    invoke<void>('commit', { repo, message }),
  /** Replaces the last commit; nothing needs to be staged. */
  amend: (repo: string, message: string) =>
    invoke<void>('amend', { repo, message }),
  lastCommit: (repo: string) =>
    invoke<LastCommit | null>('last_commit', { repo }),
  diff: (
    repo: string,
    path: string,
    staged: boolean,
    untracked: boolean,
    ignoreWhitespace = false,
  ) =>
    invoke<string>('diff', {
      repo,
      path,
      staged,
      untracked,
      ignoreWhitespace,
    }),
  branches: (repo: string) => invoke<Branch[]>('branches', { repo }),
  switchBranch: (repo: string, name: string) =>
    invoke<void>('switch_branch', { repo, name }),
  createBranch: (repo: string, name: string) =>
    invoke<void>('create_branch', { repo, name }),
  /** Without `force`, a branch with unmerged commits is kept and reported. */
  deleteBranch: (repo: string, name: string, force = false) =>
    invoke<{ notMerged: boolean }>('delete_branch', { repo, name, force }),
  renameBranch: (repo: string, old: string, newName: string) =>
    invoke<void>('rename_branch', { repo, old, new: newName }),
  log: (repo: string, limit = 200) => invoke<Commit[]>('log', { repo, limit }),
  /** Commits whose message or author contains `query`, or with that hash. */
  searchLog: (repo: string, query: string, limit = 500) =>
    invoke<Commit[]>('search_log', { repo, query, limit }),
  /** Commits on the current branch that changed `path`, across renames. */
  fileLog: (repo: string, path: string, limit = 1000) =>
    invoke<Commit[]>('file_log', { repo, path, limit }),
  /** Blames a file at a commit, or (null) as it is on disk. */
  blame: (
    repo: string,
    path: string,
    rev: string | null,
    ignoreWhitespace: boolean,
    followMoves: boolean,
  ) =>
    invoke<Blame>('blame', { repo, path, rev, ignoreWhitespace, followMoves }),
  /** Graph rows for `commits` (hash and parents, newest first). */
  graphLayout: (commits: [string, string[]][]) =>
    invoke<GraphRow[]>('graph_layout', { commits }),
  showCommit: (repo: string, hash: string, ignoreWhitespace = false) =>
    invoke<string>('show_commit', { repo, hash, ignoreWhitespace }),
  merge: (repo: string, branch: string) =>
    invoke<{ conflicts: boolean }>('merge', { repo, branch }),
  mergeAbort: (repo: string) => invoke<void>('merge_abort', { repo }),
  mergeCommit: (repo: string) => invoke<void>('merge_commit', { repo }),
  cherryPick: (repo: string, hash: string) =>
    invoke<{ conflicts: boolean }>('cherry_pick', { repo, hash }),
  revert: (repo: string, hash: string) =>
    invoke<{ conflicts: boolean }>('revert', { repo, hash }),
  reset: (repo: string, hash: string, mode: ResetMode) =>
    invoke<void>('reset', { repo, hash, mode }),
  /** Creates a branch at `hash` and switches to it. */
  createBranchAt: (repo: string, name: string, hash: string) =>
    invoke<void>('create_branch_at', { repo, name, hash }),
  /** With a message the tag is annotated. */
  createTag: (repo: string, name: string, hash: string, message = '') =>
    invoke<void>('create_tag', { repo, name, hash, message }),
  deleteTag: (repo: string, name: string) =>
    invoke<void>('delete_tag', { repo, name }),
  /** Without a remote, pushes to the current branch's. */
  pushTag: (repo: string, name: string, remote: string | null = null) =>
    invoke<void>('push_tag', { repo, name, remote }),
  conflictParts: (repo: string, path: string) =>
    invoke<ConflictPart[]>('conflict_parts', { repo, path }),
  resolveBlock: (
    repo: string,
    path: string,
    index: number,
    choice: 'ours' | 'theirs' | 'both',
  ) => invoke<void>('resolve_block', { repo, path, index, choice }),
  resolveBlockText: (repo: string, path: string, index: number, text: string) =>
    invoke<void>('resolve_block_text', { repo, path, index, text }),
  resolveFile: (repo: string, path: string, side: 'ours' | 'theirs') =>
    invoke<void>('resolve_file', { repo, path, side }),
  markResolved: (repo: string, path: string) =>
    invoke<void>('mark_resolved', { repo, path }),
  rebasePlan: (repo: string, from: string) =>
    invoke<RebasePlan>('rebase_plan', { repo, from }),
  rebaseStart: (repo: string, from: string, items: TodoItem[]) =>
    invoke<{ stopped: boolean }>('rebase_start', { repo, from, items }),
  rebaseContinue: (repo: string) =>
    invoke<{ stopped: boolean }>('rebase_continue', { repo }),
  rebaseAbort: (repo: string) => invoke<void>('rebase_abort', { repo }),
  pushForce: (repo: string) => invoke<void>('push_force', { repo }),
  stashes: (repo: string) => invoke<Stash[]>('stashes', { repo }),
  stashPush: (repo: string, message: string, includeUntracked: boolean) =>
    invoke<void>('stash_push', { repo, message, includeUntracked }),
  stashApply: (repo: string, index: number) =>
    invoke<void>('stash_apply', { repo, index }),
  stashPop: (repo: string, index: number) =>
    invoke<void>('stash_pop', { repo, index }),
  stashDrop: (repo: string, index: number) =>
    invoke<void>('stash_drop', { repo, index }),
  stashShow: (repo: string, index: number, ignoreWhitespace = false) =>
    invoke<string>('stash_show', { repo, index, ignoreWhitespace }),
  undoAvailable: (repo: string) =>
    invoke<Undoable | null>('undo_available', { repo }),
  /** Fails when `id` isn't what `undoAvailable` offers anymore. */
  undo: (repo: string, id: number) => invoke<void>('undo_last', { repo, id }),
  /** Newest first; null for HEAD. */
  reflog: (repo: string, branch: string | null) =>
    invoke<ReflogEntry[]>('reflog', { repo, branch }),
  lostStashes: (repo: string) =>
    invoke<ReflogEntry[]>('lost_stashes', { repo }),
  recoverStash: (repo: string, hash: string) =>
    invoke<void>('recover_stash', { repo, hash }),
  /** Without a remote, fetches all of them. */
  fetch: (repo: string, remote: string | null, prune: boolean) =>
    invoke<void>('fetch', { repo, remote, prune }),
  /** Without a mode, follows `pull.rebase` or only fast-forwards. */
  pull: (repo: string, mode: PullMode | null = null, remember = false) =>
    invoke<{ diverged: boolean; conflicts: boolean }>('pull', {
      repo,
      mode,
      remember,
    }),
  /** `remote` is where a branch without an upstream gets published. */
  push: (repo: string, remote: string | null = null) =>
    invoke<void>('push', { repo, remote }),
  clone: (url: string, parent: string, name: string) =>
    invoke<RepoInfo>('clone_repo', { url, parent, name }),
  /** Makes a running `clone` fail; it removes the half-cloned folder first. */
  cancelClone: () => invoke<void>('cancel_clone'),
  remotes: (repo: string) => invoke<Remote[]>('remotes', { repo }),
  /** Branches of all remotes, e.g. "origin/main". */
  remoteBranches: (repo: string) =>
    invoke<string[]>('remote_branches', { repo }),
  addRemote: (repo: string, name: string, url: string) =>
    invoke<void>('add_remote', { repo, name, url }),
  renameRemote: (repo: string, old: string, newName: string) =>
    invoke<void>('rename_remote', { repo, old, new: newName }),
  setRemoteUrl: (repo: string, name: string, url: string) =>
    invoke<void>('set_remote_url', { repo, name, url }),
  removeRemote: (repo: string, name: string) =>
    invoke<void>('remove_remote', { repo, name }),
  /** Null clears the branch's upstream. */
  setUpstream: (repo: string, branch: string, upstream: string | null) =>
    invoke<void>('set_upstream', { repo, branch, upstream }),
}

/** A change shown in the "Staged" list, i.e. something in the index. */
export const isStaged = (f: FileChange) =>
  !f.untracked && !f.conflicted && f.index !== '.'

/** A change shown in the "Changes" list, i.e. not yet in the index. */
export const isUnstaged = (f: FileChange) =>
  f.untracked || f.conflicted || f.worktree !== '.'

export function errorMessage(e: unknown): string {
  return typeof e === 'string' ? e : e instanceof Error ? e.message : String(e)
}

/** Files on disk that have a past to look at. */
export const canBlame = (f: FileChange) =>
  !f.untracked && f.index !== 'A' && f.index !== 'D' && f.worktree !== 'D'
