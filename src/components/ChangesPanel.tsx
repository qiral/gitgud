import { useState } from 'react'
import { confirm } from '@tauri-apps/plugin-dialog'
import { Archive, GitMerge, Minus, Plus, Undo2 } from 'lucide-react'
import {
  git,
  isStaged,
  isUnstaged,
  type FileChange,
  type RepoInfo,
  type Status,
} from '../lib/git'
import type { Selection } from './RepoView'

interface Props {
  repo: RepoInfo
  files: FileChange[]
  /** Set while a merge is in progress, e.g. "Merge branch 'feature'". */
  merging: string | null
  /** Set while an interactive rebase is stopped. */
  rebasing: Status['rebasing']
  selection: Selection | null
  onSelect: (s: Selection) => void
  busy: boolean
  onStash: () => void
  act: (label: string, action: () => Promise<unknown>) => Promise<boolean>
}

export default function ChangesPanel({
  repo,
  files,
  merging,
  rebasing,
  selection,
  onSelect,
  busy,
  onStash,
  act,
}: Props) {
  const [message, setMessage] = useState('')
  const conflicts = files.filter((f) => f.conflicted)
  const staged = files.filter(isStaged)
  const unstaged = files.filter((f) => isUnstaged(f) && !f.conflicted)
  const paths = (list: FileChange[]) => list.map((f) => f.path)

  // A merge can be committed once nothing is conflicted, even with no
  // staged files, and git already has a message for it.
  const canCommit =
    merging || rebasing
      ? conflicts.length === 0
      : message.trim() !== '' && staged.length > 0

  async function commit() {
    if (!canCommit) return
    if (rebasing) {
      await act('rebase', () => git.rebaseContinue(repo.path))
      return
    }
    const done = await act('commit', () =>
      merging && !message.trim()
        ? git.mergeCommit(repo.path)
        : git.commit(repo.path, message),
    )
    if (done) setMessage('')
  }

  async function abortMerge() {
    const ok = await confirm(
      'Abort the merge? Your branch goes back to how it was before merging, and conflict resolutions are lost.',
      { title: 'Abort merge', kind: 'warning' },
    )
    if (ok) act('merge', () => git.mergeAbort(repo.path))
  }

  async function abortRebase() {
    const ok = await confirm(
      rebasing?.editingHistory
        ? 'Abort the rebase? Your branch goes back to how it was before you started editing history.'
        : 'Abort the rebase? Your branch goes back to how it was before pulling.',
      { title: 'Abort rebase', kind: 'warning' },
    )
    if (ok) act('rebase', () => git.rebaseAbort(repo.path))
  }

  async function discard(file: FileChange) {
    const ok = await confirm(
      `Discard changes to ${file.path}? This cannot be undone.`,
      { title: 'Discard changes', kind: 'warning' },
    )
    if (ok) act('discard', () => git.discard(repo.path, [file.path]))
  }

  const isSelected = (f: FileChange, inStaged: boolean) =>
    selection?.kind === 'file' &&
    selection.staged === inStaged &&
    selection.file.path === f.path

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {(merging || rebasing) && (
        <div className="border-b border-line bg-modified/10 px-3 py-2">
          <div className="flex items-center gap-2 font-medium">
            <GitMerge className="size-4 shrink-0 text-modified" />
            <span
              className="min-w-0 flex-1 truncate"
              title={merging ?? undefined}
            >
              {merging ??
                `${rebasing!.editingHistory ? 'Editing history of' : 'Rebasing'} ${rebasing!.branch} (step ${rebasing!.step} of ${rebasing!.total})`}
            </span>
          </div>
          <div className="mt-1 flex items-center gap-2 text-xs text-muted">
            <span className="flex-1">
              {conflicts.length > 0
                ? `${conflicts.length} conflicted file${conflicts.length > 1 ? 's' : ''} to resolve`
                : merging
                  ? 'All conflicts resolved. Commit to finish the merge.'
                  : 'All conflicts resolved. Continue to apply the next commits.'}
            </span>
            <button
              onClick={merging ? abortMerge : abortRebase}
              disabled={busy}
              className="rounded border border-line px-2 py-0.5 text-fg hover:bg-hover disabled:opacity-40"
            >
              {merging ? 'Abort merge' : 'Abort'}
            </button>
          </div>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-auto">
        <FileList
          title="Conflicts"
          files={conflicts}
          staged={false}
          isSelected={isSelected}
          onSelect={(file) => onSelect({ kind: 'file', file, staged: false })}
        />
        <FileList
          title="Staged"
          files={staged}
          staged
          isSelected={isSelected}
          onSelect={(file) => onSelect({ kind: 'file', file, staged: true })}
          bulkLabel="Unstage all"
          onBulk={() =>
            act('unstage', () => git.unstage(repo.path, paths(staged)))
          }
          onToggle={(f) =>
            act('unstage', () => git.unstage(repo.path, [f.path]))
          }
        />
        <FileList
          title="Changes"
          files={unstaged}
          staged={false}
          isSelected={isSelected}
          onSelect={(file) => onSelect({ kind: 'file', file, staged: false })}
          bulkLabel="Stage all"
          onBulk={() =>
            act('stage', () => git.stage(repo.path, paths(unstaged)))
          }
          onToggle={(f) => act('stage', () => git.stage(repo.path, [f.path]))}
          onDiscard={discard}
        />
        {files.length === 0 && (
          <p className="p-6 text-center text-muted">No local changes</p>
        )}
      </div>

      <div className="border-t border-line p-3">
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) commit()
          }}
          disabled={rebasing !== null}
          placeholder={
            rebasing
              ? 'Commits keep their messages while rebasing'
              : merging
                ? 'Merge message (optional)'
                : 'Commit message'
          }
          rows={3}
          className="w-full resize-none rounded border border-line bg-bg p-2 outline-none select-text focus:border-accent"
        />
        <div className="mt-2 flex gap-2">
          <button
            onClick={commit}
            disabled={busy || !canCommit}
            title="Ctrl+Enter"
            className="flex-1 rounded bg-accent py-1.5 font-medium text-white hover:opacity-90 disabled:opacity-40"
          >
            {rebasing
              ? 'Continue rebase'
              : merging
                ? 'Commit merge'
                : `Commit${staged.length > 0 ? ` ${staged.length} file${staged.length > 1 ? 's' : ''}` : ''}`}
          </button>
          <button
            onClick={onStash}
            disabled={
              busy ||
              files.length === 0 ||
              merging !== null ||
              rebasing !== null
            }
            title="Stash all changes"
            className="flex items-center gap-1.5 rounded border border-line px-3 hover:bg-hover disabled:opacity-40"
          >
            <Archive className="size-4" />
            Stash
          </button>
        </div>
      </div>
    </div>
  )
}

interface FileListProps {
  title: string
  files: FileChange[]
  staged: boolean
  isSelected: (f: FileChange, staged: boolean) => boolean
  onSelect: (f: FileChange) => void
  bulkLabel?: string
  onBulk?: () => void
  onToggle?: (f: FileChange) => void
  onDiscard?: (f: FileChange) => void
}

function FileList({
  title,
  files,
  staged,
  isSelected,
  onSelect,
  bulkLabel,
  onBulk,
  onToggle,
  onDiscard,
}: FileListProps) {
  if (files.length === 0) return null
  return (
    <section>
      <div className="flex items-center justify-between px-3 pt-3 pb-1 text-xs font-semibold tracking-wide text-muted uppercase">
        <span>
          {title} ({files.length})
        </span>
        {onBulk && (
          <button
            onClick={onBulk}
            className="font-normal tracking-normal normal-case hover:text-fg"
          >
            {bulkLabel}
          </button>
        )}
      </div>
      <ul>
        {files.map((f) => (
          <li
            key={f.path}
            onClick={() => onSelect(f)}
            className={`group flex cursor-default items-center gap-2 px-3 py-1 ${
              isSelected(f, staged) ? 'bg-hover' : 'hover:bg-hover/60'
            }`}
          >
            <StatusBadge file={f} staged={staged} />
            <span className="min-w-0 flex-1 truncate" title={f.path}>
              <span>{basename(f.path)}</span>
              <span className="ml-1.5 text-xs text-muted">
                {dirname(f.path)}
              </span>
            </span>
            {onDiscard && !f.untracked && !f.conflicted && (
              <RowButton title="Discard changes" onClick={() => onDiscard(f)}>
                <Undo2 className="size-3.5" />
              </RowButton>
            )}
            {onToggle && (
              <RowButton
                title={staged ? 'Unstage' : 'Stage'}
                onClick={() => onToggle(f)}
              >
                {staged ? (
                  <Minus className="size-3.5" />
                ) : (
                  <Plus className="size-3.5" />
                )}
              </RowButton>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}

function RowButton({
  title,
  onClick,
  children,
}: {
  title: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      title={title}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      className="invisible rounded p-0.5 text-muted group-hover:visible hover:bg-line hover:text-fg"
    >
      {children}
    </button>
  )
}

const LABELS: Record<string, [string, string]> = {
  M: ['M', 'text-modified'],
  A: ['A', 'text-added'],
  D: ['D', 'text-removed'],
  R: ['R', 'text-accent'],
  C: ['C', 'text-accent'],
  T: ['T', 'text-modified'],
  '?': ['U', 'text-added'],
}

function StatusBadge({ file, staged }: { file: FileChange; staged: boolean }) {
  const [letter, color] = file.conflicted
    ? ['!', 'text-removed']
    : (LABELS[staged ? file.index : file.worktree] ?? ['?', 'text-muted'])
  return (
    <span className={`w-3 text-center font-mono text-xs font-bold ${color}`}>
      {letter}
    </span>
  )
}

function basename(path: string) {
  return path.slice(path.lastIndexOf('/') + 1)
}

function dirname(path: string) {
  const i = path.lastIndexOf('/')
  return i === -1 ? '' : path.slice(0, i)
}
