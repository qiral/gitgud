import { useState } from 'react'
import { confirm } from '@tauri-apps/plugin-dialog'
import { Loader2 } from 'lucide-react'
import { git, type Commit, type ResetMode, type Status } from '../lib/git'
import Dialog from './Dialog'
import PromptDialog from './PromptDialog'
import { useTranslation, type Translate } from '../i18n'

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
  const { t } = useTranslation()
  const [open, setOpen] = useState<Open | null>(null)
  const close = () => setOpen(null)
  const branch = status?.branch ?? null
  // Cherry-pick, revert and reset change the current branch, which needs
  // to be a branch and not in the middle of something else.
  const onBranch = branch !== null && !status?.merging && !status?.rebasing

  async function deleteTag(name: string) {
    const ok = await confirm(t('commitactions.delete-tag-body', { name }), {
      title: t('commitactions.delete-tag'),
      kind: 'warning',
      okLabel: t('commitactions.delete'),
    })
    if (ok) act('tag', () => git.deleteTag(repo, name))
  }

  async function revert(c: Commit) {
    const ok = await confirm(
      t('commitactions.revert-body', {
        branch,
        subject: c.subject,
        hash: c.shortHash,
      }),
      {
        title: t('commitactions.revert-commit'),
        kind: 'info',
        okLabel: t('commitactions.revert'),
      },
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
        title={t('commitactions.create-branch')}
        label={t('commitactions.branch-name')}
        description={t('commitactions.create-branch-desc', {
          hash: open.commit.shortHash,
          subject: open.commit.subject,
        })}
        placeholder="feature/my-idea"
        submitLabel={t('commitactions.create-branch')}
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
  const { t } = useTranslation()
  const [message, setMessage] = useState('')
  return (
    <PromptDialog
      title={t('commitactions.create-tag')}
      label={t('commitactions.tag-name')}
      description={t('commitactions.create-tag-desc', {
        hash: commit.shortHash,
        subject: commit.subject,
      })}
      placeholder={t('commitactions.v1-0-0')}
      submitLabel={t('commitactions.create-tag')}
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

const MODES = (
  t: Translate,
): { mode: ResetMode; label: string; hint: string }[] => [
  {
    mode: 'soft',
    label: t('commitactions.soft'),
    hint: t('commitactions.hint-soft'),
  },
  {
    mode: 'mixed',
    label: t('commitactions.mixed'),
    hint: t('commitactions.hint-mixed'),
  },
  {
    mode: 'hard',
    label: t('commitactions.hard'),
    hint: t('commitactions.hint-hard'),
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
  const { t } = useTranslation()
  const [mode, setMode] = useState<ResetMode>('mixed')
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (
      mode === 'hard' &&
      !(await confirm(
        dirty
          ? t('commitactions.hard-reset-dirty')
          : t('commitactions.hard-reset-clean'),
        {
          title: t('commitactions.hard-reset'),
          kind: 'warning',
          okLabel: t('commitactions.reset'),
        },
      ))
    )
      return
    setBusy(true)
    const done = await act('reset', () => git.reset(repo, commit.hash, mode))
    setBusy(false)
    if (done) onClose()
  }

  return (
    <Dialog title={t('commitactions.reset-branch')} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <p className="text-muted">
          {t('commitactions.move')}{' '}
          <span className="font-medium text-fg">{branch}</span> back to{' '}
          <span className="font-mono">{commit.shortHash}</span> “
          {commit.subject}”. Pushed commits that get removed need a force push
          afterwards.
        </p>
        <div className="space-y-1">
          {MODES(t).map((m) => (
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
