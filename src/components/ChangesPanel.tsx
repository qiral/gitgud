import { useEffect, useRef, useState } from 'react'
import { confirm } from '@tauri-apps/plugin-dialog'
import {
  Archive,
  EyeOff,
  GitMerge,
  Loader2,
  Minus,
  Plus,
  Sparkles,
  Undo2,
} from 'lucide-react'
import {
  git,
  isStaged,
  isUnstaged,
  type FileChange,
  type IgnoreKind,
  type Operation,
  type RepoInfo,
  type Status,
} from '../lib/git'
import { fileMenuItems } from '../lib/copy'
import { basename, dirname, extension } from '../lib/paths'
import { useContextMenu, type MenuItem } from './ContextMenu'
import SuggestionDiff from './SuggestionDiff'
import type { Selection } from './RepoView'
import { useTranslation } from '../i18n'

interface Props {
  repo: RepoInfo
  files: FileChange[]
  /** Set while a merge, cherry-pick or revert is in progress, e.g.
   *  "Merge branch 'feature'". */
  merging: string | null
  operation?: Operation | null
  /** Set while an interactive rebase is stopped. */
  rebasing: Status['rebasing']
  /** False on an unborn branch, where there is nothing to amend. */
  hasCommits: boolean
  selection: Selection | null
  onSelect: (s: Selection) => void
  busy: boolean
  onStash: () => void
  onFileHistory?: (path: string) => void
  /** Asks Copilot for a message for the staged changes; null on failure. */
  onGenerateMessage?: () => Promise<string | null>
  act: (label: string, action: () => Promise<unknown>) => Promise<boolean>
}

export default function ChangesPanel({
  repo,
  files,
  merging,
  operation = 'merge',
  rebasing,
  hasCommits,
  selection,
  onSelect,
  busy,
  onStash,
  onFileHistory,
  onGenerateMessage,
  act,
}: Props) {
  const { t, tp } = useTranslation()
  const [message, setMessage] = useState('')
  const [generating, setGenerating] = useState(false)
  // Copilot's message while it waits to be accepted over what was typed.
  const [suggested, setSuggested] = useState<string | null>(null)
  // What's typed by the time Copilot answers, not when it was asked.
  const typed = useRef(message)
  typed.current = message
  // While amending, the message being typed before is kept to put back.
  const [amending, setAmending] = useState<{
    draft: string
    pushed: boolean
  } | null>(null)
  const canAmend = hasCommits && !merging && !rebasing
  // A merge or rebase starting meanwhile ends amending.
  useEffect(() => {
    if (!canAmend) setAmending(null)
  }, [canAmend])
  const { menu, open } = useContextMenu()
  const conflicts = files.filter((f) => f.conflicted)
  const staged = files.filter(isStaged)
  const unstaged = files.filter((f) => isUnstaged(f) && !f.conflicted)
  const paths = (list: FileChange[]) => list.map((f) => f.path)

  // A merge can be committed once nothing is conflicted, even with no
  // staged files, and git already has a message for it.
  const canCommit =
    merging || rebasing
      ? conflicts.length === 0
      : message.trim() !== '' && (staged.length > 0 || amending !== null)

  async function toggleAmend(on: boolean) {
    if (!on) {
      setMessage(amending?.draft ?? '')
      setAmending(null)
      return
    }
    let last: Awaited<ReturnType<typeof git.lastCommit>> = null
    await act('amend', async () => {
      last = await git.lastCommit(repo.path)
    })
    if (!last) return
    const { message: previous, pushed } = last
    setAmending({ draft: message, pushed })
    setMessage(previous)
  }

  async function generateMessage() {
    if (!onGenerateMessage) return
    setGenerating(true)
    try {
      const generated = await onGenerateMessage()
      if (generated === null) return
      if (typed.current.trim()) setSuggested(generated)
      else setMessage(generated)
    } finally {
      setGenerating(false)
    }
  }

  async function commit() {
    if (!canCommit) return
    if (rebasing) {
      await act('rebase', () => git.rebaseContinue(repo.path))
      return
    }
    if (amending) {
      if (
        amending.pushed &&
        !(await confirm(
          t(
            'changespanel.the-last-commit-is-already-pushed-after-amending-it-your-branch-and-the-remote-have-different-histories-and-only-a-force-push-can-update-the-remote',
          ),
          {
            title: t('changespanel.amend-pushed-commit'),
            kind: 'warning',
            okLabel: t('changespanel.amend'),
          },
        ))
      )
        return
      if (await act('commit', () => git.amend(repo.path, message))) {
        setAmending(null)
        setMessage('')
      }
      return
    }
    const done = await act('commit', () =>
      merging && !message.trim()
        ? git.mergeCommit(repo.path)
        : git.commit(repo.path, message),
    )
    if (done) setMessage('')
  }

  const operationName =
    operation === 'cherryPick'
      ? 'cherry-pick'
      : operation === 'revert'
        ? 'revert'
        : 'merge'
  // The operation as a word in the active language, for the sentences below.
  const what = t(`changespanel.operation-${operationName}`)

  async function abortMerge() {
    const ok = await confirm(t('changespanel.abort-merge-body', { what }), {
      title: t('changespanel.abort-what', { what }),
      kind: 'warning',
    })
    if (ok) act('merge', () => git.mergeAbort(repo.path))
  }

  async function abortRebase() {
    const ok = await confirm(
      rebasing?.editingHistory
        ? t('changespanel.abort-rebase-history')
        : t('changespanel.abort-rebase-pull'),
      { title: t('changespanel.abort-rebase'), kind: 'warning' },
    )
    if (ok) act('rebase', () => git.rebaseAbort(repo.path))
  }

  async function discard(file: FileChange) {
    const ok = await confirm(
      t('changespanel.discard-file-body', { path: file.path }),
      { title: t('changespanel.discard-changes'), kind: 'warning' },
    )
    if (ok) act('discard', () => git.discard(repo.path, [file.path]))
  }

  function ignore(path: string, kind: IgnoreKind) {
    act('ignore', () => git.ignore(repo.path, path, kind))
  }

  /** Ways to add an untracked file to .gitignore. */
  function ignoreItems(path: string): MenuItem[] {
    const items: MenuItem[] = [
      {
        label: t('changespanel.ignore-file'),
        icon: EyeOff,
        onClick: () => ignore(path, 'file'),
      },
    ]
    const ext = extension(path)
    if (ext)
      items.push({
        label: t('changespanel.ignore-extension', { ext }),
        icon: EyeOff,
        onClick: () => ignore(path, 'extension'),
      })
    const dir = dirname(path)
    if (dir)
      items.push({
        label: t('changespanel.ignore-folder', { dir }),
        icon: EyeOff,
        onClick: () => ignore(path, 'folder'),
      })
    return items
  }

  /** Right-click actions for a file; mirrors the buttons on its row. */
  function menuFor(f: FileChange, inStaged: boolean): MenuItem[] {
    const items: MenuItem[] = []
    if (!f.conflicted) {
      items.push(
        inStaged
          ? {
              label: t('changespanel.unstage'),
              icon: Minus,
              onClick: () =>
                act('unstage', () => git.unstage(repo.path, [f.path])),
            }
          : {
              label: t('changespanel.stage'),
              icon: Plus,
              onClick: () => act('stage', () => git.stage(repo.path, [f.path])),
            },
      )
      if (!inStaged && !f.untracked)
        items.push({
          label: t('changespanel.discard-changes-2'),
          icon: Undo2,
          danger: true,
          onClick: () => discard(f),
        })
      items.push('separator')
    }
    if (f.untracked) items.push(...ignoreItems(f.path), 'separator')
    const deleted = f.worktree === 'D' || f.index === 'D'
    const history =
      onFileHistory && !f.untracked && f.index !== 'A'
        ? () => onFileHistory(f.path)
        : undefined
    return [...items, ...fileMenuItems(repo.path, f.path, !deleted, history)]
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
                t('changespanel.rebase-status', {
                  mode: rebasing!.editingHistory
                    ? t('changespanel.editing-history-of')
                    : t('changespanel.rebasing'),
                  branch: rebasing!.branch,
                  step: rebasing!.step,
                  total: rebasing!.total,
                })}
            </span>
          </div>
          <div className="mt-1 flex items-center gap-2 text-xs text-muted">
            <span className="flex-1">
              {conflicts.length > 0
                ? tp('changespanel.conflicted-files', conflicts.length)
                : merging
                  ? t('changespanel.all-resolved-commit', { what })
                  : t('changespanel.all-resolved-continue')}
            </span>
            <button
              onClick={merging ? abortMerge : abortRebase}
              disabled={busy}
              className="rounded border border-line px-2 py-0.5 text-fg hover:bg-hover disabled:opacity-40"
            >
              {merging
                ? t('changespanel.abort-what', { what })
                : t('changespanel.abort')}
            </button>
          </div>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-auto">
        <FileList
          title={t('changespanel.conflicts')}
          onMenu={(e, f) => open(e, menuFor(f, false))}
          files={conflicts}
          staged={false}
          isSelected={isSelected}
          onSelect={(file) => onSelect({ kind: 'file', file, staged: false })}
        />
        <FileList
          title={t('changespanel.staged')}
          onMenu={(e, f) => open(e, menuFor(f, true))}
          files={staged}
          staged
          isSelected={isSelected}
          onSelect={(file) => onSelect({ kind: 'file', file, staged: true })}
          bulkLabel={t('changespanel.unstage-all')}
          onBulk={() =>
            act('unstage', () => git.unstage(repo.path, paths(staged)))
          }
          onToggle={(f) =>
            act('unstage', () => git.unstage(repo.path, [f.path]))
          }
        />
        <FileList
          title={t('changespanel.changes')}
          onMenu={(e, f) => open(e, menuFor(f, false))}
          files={unstaged}
          staged={false}
          isSelected={isSelected}
          onSelect={(file) => onSelect({ kind: 'file', file, staged: false })}
          bulkLabel={t('changespanel.stage-all')}
          onBulk={() =>
            act('stage', () => git.stage(repo.path, paths(unstaged)))
          }
          onToggle={(f) => act('stage', () => git.stage(repo.path, [f.path]))}
          onDiscard={discard}
        />
        {files.length === 0 && (
          <p className="p-6 text-center text-muted">
            {t('changespanel.no-local-changes')}
          </p>
        )}
      </div>
      {menu}

      <div className="border-t border-line p-3">
        <div className="relative">
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) commit()
            }}
            disabled={rebasing !== null}
            placeholder={
              rebasing
                ? t('changespanel.placeholder-rebasing')
                : merging
                  ? t('changespanel.placeholder-message-what', {
                      what:
                        operationName === 'merge'
                          ? t('changespanel.merge')
                          : t('changespanel.commit'),
                    })
                  : t('changespanel.placeholder-commit-message')
            }
            rows={3}
            className="w-full resize-none rounded border border-line bg-bg p-2 pr-8 outline-none select-text focus:border-accent"
          />
          {onGenerateMessage && (
            <button
              onClick={generateMessage}
              disabled={
                busy ||
                generating ||
                staged.length === 0 ||
                merging !== null ||
                rebasing !== null
              }
              title={t('changespanel.generate-commit-message-with-copilot')}
              aria-label={t(
                'changespanel.generate-commit-message-with-copilot',
              )}
              className="absolute top-1.5 right-1.5 rounded p-1 text-muted hover:bg-hover hover:text-fg disabled:opacity-40"
            >
              {generating ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Sparkles className="size-4" />
              )}
            </button>
          )}
        </div>
        {suggested !== null && (
          <div className="mt-2">
            <SuggestionDiff
              label={t('changespanel.copilot-s-message')}
              before={message}
              after={suggested}
              onAccept={() => {
                setMessage(suggested)
                setSuggested(null)
              }}
              onReject={() => setSuggested(null)}
            />
          </div>
        )}
        {canAmend && (
          <label
            className="mt-1 flex items-center gap-2 text-xs text-muted"
            title={t(
              'changespanel.replace-the-last-commit-with-these-changes-and-this-message',
            )}
          >
            <input
              type="checkbox"
              checked={amending !== null}
              disabled={busy}
              onChange={(e) => toggleAmend(e.target.checked)}
              className="accent-accent"
            />
            {t('changespanel.amend-last-commit')}
          </label>
        )}
        <div className="mt-2 flex gap-2">
          <button
            onClick={commit}
            disabled={busy || !canCommit || suggested !== null}
            title={t('changespanel.ctrl-enter')}
            className="flex-1 rounded bg-accent py-1.5 font-medium text-on-accent hover:opacity-90 disabled:opacity-40"
          >
            {rebasing
              ? t('changespanel.continue-rebase')
              : merging
                ? t('changespanel.commit-what', { what })
                : amending
                  ? staged.length > 0
                    ? tp('changespanel.amend-with-files', staged.length)
                    : t('changespanel.amend-last-commit')
                  : staged.length > 0
                    ? tp('changespanel.commit-files', staged.length)
                    : t('changespanel.commit')}
          </button>
          <button
            onClick={onStash}
            disabled={
              busy ||
              files.length === 0 ||
              merging !== null ||
              rebasing !== null
            }
            title={t('changespanel.stash-all-changes')}
            className="flex items-center gap-1.5 rounded border border-line px-3 hover:bg-hover disabled:opacity-40"
          >
            <Archive className="size-4" />
            {t('changespanel.stash')}
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
  onMenu: (e: React.MouseEvent, f: FileChange) => void
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
  onMenu,
  bulkLabel,
  onBulk,
  onToggle,
  onDiscard,
}: FileListProps) {
  const { t } = useTranslation()
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
            onContextMenu={(e) => {
              onSelect(f)
              onMenu(e, f)
            }}
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
              <RowButton
                title={t('changespanel.discard-changes')}
                onClick={() => onDiscard(f)}
              >
                <Undo2 className="size-3.5" />
              </RowButton>
            )}
            {onToggle && (
              <RowButton
                title={
                  staged ? t('changespanel.unstage') : t('changespanel.stage')
                }
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
