import { useState } from 'react'
import { confirm } from '@tauri-apps/plugin-dialog'
import { Loader2 } from 'lucide-react'
import { git, type Commit, type ResetMode, type Status } from '../lib/git'
import Dialog from './Dialog'
import PromptDialog from './PromptDialog'

/** What can be done to a commit in History. Unset entries are hidden. */
export interface CommitActions {
  createBranch: (c: Commit) => void
  createTag: (c: Commit) => void
  deleteTag: (name: string) => void
  pushTag: (name: string) => void
  cherryPick?: (c: Commit) => void
  revert?: (c: Commit) => void
  reset?: (c: Commit) => void
}

type Act = (label: string, action: () => Promise<unknown>) => Promise<boolean>

type Open =
  | { kind: 'branch'; commit: Commit }
  | { kind: 'tag'; commit: Commit }
  | { kind: 'reset'; commit: Commit }

/**
 * The commit actions for History, plus the dialogs some of them open.
 * Render `dialogs` once next to the panel.
 */
export function useCommitActions(
  repo: string,
  status: Status | null,
  act: Act,
): { actions: CommitActions; dialogs: React.ReactNode } {
  const [open, setOpen] = useState<Open | null>(null)
  const close = () => setOpen(null)
  const branch = status?.branch ?? null
  // Cherry-pick, revert and reset change the current branch, which needs
  // to be a branch and not in the middle of something else.
  const onBranch = branch !== null && !status?.merging && !status?.rebasing

  async function deleteTag(name: string) {
    const ok = await confirm(
      `Delete the tag ${name}? If it was pushed, the remote keeps its copy.`,
      { title: 'Delete tag', kind: 'warning', okLabel: 'Delete' },
    )
    if (ok) act('tag', () => git.deleteTag(repo, name))
  }

  async function revert(c: Commit) {
    const ok = await confirm(
      `Add a commit to ${branch} that undoes “${c.subject}” (${c.shortHash})?`,
      { title: 'Revert commit', kind: 'info', okLabel: 'Revert' },
    )
    if (ok) act('revert', () => git.revert(repo, c.hash))
  }

  const actions: CommitActions = {
    createBranch: (commit) => setOpen({ kind: 'branch', commit }),
    createTag: (commit) => setOpen({ kind: 'tag', commit }),
    deleteTag,
    pushTag: (name) => act('push', () => git.pushTag(repo, name)),
    ...(onBranch && {
      cherryPick: (c: Commit) =>
        act('cherryPick', () => git.cherryPick(repo, c.hash)),
      revert,
      reset: (commit: Commit) => setOpen({ kind: 'reset', commit }),
    }),
  }

  const dialogs =
    open?.kind === 'branch' ? (
      <PromptDialog
        title="Create branch"
        label="Branch name"
        description={`Starts at ${open.commit.shortHash} “${open.commit.subject}”, and switches to it.`}
        placeholder="feature/my-idea"
        submitLabel="Create branch"
        onSubmit={(name) =>
          act('branch', () => git.createBranchAt(repo, name, open.commit.hash))
        }
        onClose={close}
      />
    ) : open?.kind === 'tag' ? (
      <TagDialog repo={repo} commit={open.commit} act={act} onClose={close} />
    ) : open?.kind === 'reset' && branch ? (
      <ResetDialog
        repo={repo}
        branch={branch}
        commit={open.commit}
        dirty={(status?.files.length ?? 0) > 0}
        act={act}
        onClose={close}
      />
    ) : null

  return { actions, dialogs }
}

function TagDialog({
  repo,
  commit,
  act,
  onClose,
}: {
  repo: string
  commit: Commit
  act: Act
  onClose: () => void
}) {
  const [message, setMessage] = useState('')
  return (
    <PromptDialog
      title="Create tag"
      label="Tag name"
      description={`Tags ${commit.shortHash} “${commit.subject}”.`}
      placeholder="v1.0.0"
      submitLabel="Create tag"
      onSubmit={(name) =>
        act('tag', () => git.createTag(repo, name, commit.hash, message))
      }
      onClose={onClose}
    >
      <label className="block">
        <span className="mb-1 block text-muted">
          Message (optional, makes an annotated tag)
        </span>
        <input
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          className="w-full rounded border border-line bg-bg px-2 py-1.5 outline-none focus:border-accent"
        />
      </label>
    </PromptDialog>
  )
}

const MODES: { mode: ResetMode; label: string; hint: string }[] = [
  {
    mode: 'soft',
    label: 'Soft',
    hint: 'Keep the changes of the later commits, staged.',
  },
  {
    mode: 'mixed',
    label: 'Mixed',
    hint: 'Keep the changes of the later commits, unstaged.',
  },
  {
    mode: 'hard',
    label: 'Hard',
    hint: 'Throw away the later commits and all uncommitted changes.',
  },
]

export function ResetDialog({
  repo,
  branch,
  commit,
  dirty,
  act,
  onClose,
}: {
  repo: string
  branch: string
  commit: Commit
  /** There are uncommitted changes, which a hard reset loses. */
  dirty: boolean
  act: Act
  onClose: () => void
}) {
  const [mode, setMode] = useState<ResetMode>('mixed')
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (
      mode === 'hard' &&
      !(await confirm(
        dirty
          ? 'Your uncommitted changes and every commit after this one are lost. This cannot be undone from GitGud.'
          : 'Every commit after this one is lost. This cannot be undone from GitGud.',
        { title: 'Hard reset', kind: 'warning', okLabel: 'Reset' },
      ))
    )
      return
    setBusy(true)
    const done = await act('reset', () => git.reset(repo, commit.hash, mode))
    setBusy(false)
    if (done) onClose()
  }

  return (
    <Dialog title="Reset branch" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <p className="text-muted">
          Move <span className="font-medium text-fg">{branch}</span> back to{' '}
          <span className="font-mono">{commit.shortHash}</span> “
          {commit.subject}”. Pushed commits that get removed need a force push
          afterwards.
        </p>
        <div className="space-y-1">
          {MODES.map((m) => (
            <label
              key={m.mode}
              className={`flex cursor-pointer gap-2 rounded border px-3 py-2 ${
                mode === m.mode ? 'border-accent bg-accent/5' : 'border-line'
              }`}
            >
              <input
                type="radio"
                name="mode"
                checked={mode === m.mode}
                onChange={() => setMode(m.mode)}
                className="mt-0.5 accent-accent"
              />
              <span>
                <span
                  className={`font-medium ${m.mode === 'hard' ? 'text-removed' : ''}`}
                >
                  {m.label}
                </span>
                <span className="block text-xs text-muted">{m.hint}</span>
              </span>
            </label>
          ))}
        </div>
        <button
          type="submit"
          disabled={busy}
          className={`flex w-full items-center justify-center gap-2 rounded py-2 font-medium hover:opacity-90 disabled:opacity-40 ${
            mode === 'hard'
              ? 'bg-removed text-white'
              : 'bg-accent text-on-accent'
          }`}
        >
          {busy && <Loader2 className="size-4 animate-spin" />}
          Reset {branch}
        </button>
      </form>
    </Dialog>
  )
}
