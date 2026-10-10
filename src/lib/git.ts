// Typed wrappers around the Rust commands in src-tauri/src/lib.rs.
import { invoke } from '@tauri-apps/api/core'

export interface RepoInfo {
  path: string
  name: string
}

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
  /** While a merge is in progress: its message, e.g. "Merge branch 'x'". */
  merging: string | null
  /** While a rebase is stopped, e.g. for conflicts. */
  rebasing: {
    step: number
    total: number
    branch: string
    /** True for a history edit, false for e.g. a pull with rebase. */
    editingHistory: boolean
  } | null
}

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

export interface CloneProgress {
  phase: string
  percent: number
}

export const github = {
  repos: () => invoke<RemoteRepo[]>('github_repos'),
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
  /** Applies only some lines of `diff`; `lines` index into diff.split('\n'). */
  applyLines: (
    repo: string,
    diff: string,
    lines: number[],
    action: LineAction,
  ) => invoke<void>('apply_lines', { repo, diff, lines, action }),
  commit: (repo: string, message: string) =>
    invoke<void>('commit', { repo, message }),
  diff: (repo: string, path: string, staged: boolean, untracked: boolean) =>
    invoke<string>('diff', { repo, path, staged, untracked }),
  branches: (repo: string) => invoke<Branch[]>('branches', { repo }),
  switchBranch: (repo: string, name: string) =>
    invoke<void>('switch_branch', { repo, name }),
  createBranch: (repo: string, name: string) =>
    invoke<void>('create_branch', { repo, name }),
  log: (repo: string, limit = 200) => invoke<Commit[]>('log', { repo, limit }),
  showCommit: (repo: string, hash: string) =>
    invoke<string>('show_commit', { repo, hash }),
  merge: (repo: string, branch: string) =>
    invoke<{ conflicts: boolean }>('merge', { repo, branch }),
  mergeAbort: (repo: string) => invoke<void>('merge_abort', { repo }),
  mergeCommit: (repo: string) => invoke<void>('merge_commit', { repo }),
  conflictParts: (repo: string, path: string) =>
    invoke<ConflictPart[]>('conflict_parts', { repo, path }),
  resolveBlock: (
    repo: string,
    path: string,
    index: number,
    choice: 'ours' | 'theirs' | 'both',
  ) => invoke<void>('resolve_block', { repo, path, index, choice }),
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
  stashShow: (repo: string, index: number) =>
    invoke<string>('stash_show', { repo, index }),
  fetch: (repo: string) => invoke<void>('fetch', { repo }),
  /** Without a mode, follows `pull.rebase` or only fast-forwards. */
  pull: (repo: string, mode: PullMode | null = null, remember = false) =>
    invoke<{ diverged: boolean; conflicts: boolean }>('pull', {
      repo,
      mode,
      remember,
    }),
  push: (repo: string) => invoke<void>('push', { repo }),
  clone: (url: string, parent: string, name: string) =>
    invoke<RepoInfo>('clone_repo', { url, parent, name }),
  originUrl: (repo: string) => invoke<string | null>('origin_url', { repo }),
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
