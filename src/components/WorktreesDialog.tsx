import { useEffect, useState } from 'react'
import { confirm, open as pickFolder } from '@tauri-apps/plugin-dialog'
import { FolderGit2, FolderOpen, Loader2, Lock, Trash2 } from 'lucide-react'
import {
  errorMessage,
  git,
  type Branch,
  type RepoInfo,
  type Worktree,
} from '../lib/git'
import Dialog from './Dialog'
import { useTranslation } from '../i18n'

const NEW = ''

/** Where a worktree for `branch` goes unless another folder is typed: next to
 *  the repository. */
export function suggestFolder(main: string, branch: string) {
  const name = branch.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '')
  return name ? `${main.replace(/[/\\]+$/, '')}-${name}` : ''
}

interface Props {
  repo: RepoInfo
  branches: Branch[]
  onOpen: (path: string) => void
  /** Reloads the repository: branches can be somewhere else now. */
  onChanged: () => Promise<unknown>
  onClose: () => void
}

/** Lists the worktrees, opens and removes them, and adds new ones. */
export default function WorktreesDialog({
  repo,
  branches,
  onOpen,
  onChanged,
  onClose,
}: Props) {
  const { t } = useTranslation()
  const [list, setList] = useState<Worktree[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const free = branches.filter((b) => !b.current && !b.worktree)
  const [picked, setPicked] = useState(NEW)
  const [name, setName] = useState('')
  /** Null follows the branch. */
  const [folder, setFolder] = useState<string | null>(null)

  const load = () =>
    git
      .worktrees(repo.path)
      .then(setList)
      .catch((e) => setError(errorMessage(e)))
  useEffect(() => {
    load()
  }, [repo.path])

  const branch = picked || name.trim()
  const main = list?.find((w) => w.main)?.path ?? repo.path
  const path = folder ?? suggestFolder(main, branch)

  async function run(action: () => Promise<unknown>) {
    setBusy(true)
    setError(null)
    try {
      await action()
      return true
    } catch (e) {
      setError(errorMessage(e))
      return false
    } finally {
      await Promise.all([load(), onChanged()])
      setBusy(false)
    }
  }

  async function add(e: React.FormEvent) {
    e.preventDefault()
    const done = await run(() =>
      git.addWorktree(repo.path, path.trim(), branch, picked === NEW),
    )
    if (!done) return
    setPicked(NEW)
    setName('')
    setFolder(null)
  }

  async function remove(w: Worktree) {
    const ok = await confirm(t('worktrees.remove-body', { path: w.path }), {
      title: t('worktrees.remove'),
      kind: 'warning',
      okLabel: t('worktrees.remove'),
    })
    if (!ok) return
    let dirty = false
    await run(async () => {
      dirty = (await git.removeWorktree(repo.path, w.path)).dirty
    })
    if (!dirty) return
    const force = await confirm(t('worktrees.dirty-body', { path: w.path }), {
      title: t('worktrees.remove'),
      kind: 'warning',
      okLabel: t('worktrees.remove-anyway'),
    })
    if (force) await run(() => git.removeWorktree(repo.path, w.path, true))
  }

  async function browse() {
    const dir = await pickFolder({
      directory: true,
      title: t('worktrees.folder'),
    })
    if (typeof dir !== 'string') return
    // Git wants a folder that isn't there yet, so make one inside.
    const last = suggestFolder(main, branch).split(/[/\\]/).pop()
    const separator = dir.includes('\\') ? '\\' : '/'
    setFolder(last ? `${dir.replace(/[/\\]+$/, '')}${separator}${last}` : dir)
  }

  const input =
    'w-full rounded border border-line bg-bg px-2 py-1.5 outline-none focus:border-accent'
  const iconButton =
    'rounded p-1 text-muted hover:bg-hover hover:text-fg disabled:opacity-40'

  return (
    <Dialog title={t('worktrees.title')} onClose={onClose} wide>
      <div className="space-y-4">
        {!list ? (
          !error && (
            <div className="flex justify-center p-4 text-muted">
              <Loader2 className="size-5 animate-spin" />
            </div>
          )
        ) : (
          <ul className="max-h-60 overflow-auto rounded-md border border-line">
            {list.map((w) => (
              <li
                key={w.path}
                className="flex items-center gap-3 border-b border-line px-3 py-2 last:border-b-0"
              >
                <FolderGit2
                  className={`size-4 shrink-0 ${w.current ? 'text-accent' : 'text-muted'}`}
                />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 font-medium">
                    <span className="truncate">
                      {w.branch ?? w.head?.slice(0, 7)}
                    </span>
                    {w.locked && (
                      <Lock
                        className="size-3 shrink-0 text-muted"
                        aria-label={t('worktrees.locked')}
                      />
                    )}
                    {(w.current || w.missing) && (
                      <span className="shrink-0 text-xs font-normal text-muted">
                        {t(w.missing ? 'worktrees.missing' : 'worktrees.open')}
                      </span>
                    )}
                  </span>
                  <span
                    className="block truncate text-xs text-muted select-text"
                    title={w.path}
                  >
                    {w.path}
                  </span>
                </span>
                {!w.current && !w.missing && (
                  <button
                    onClick={() => onOpen(w.path)}
                    title={t('worktrees.open-it')}
                    aria-label={t('worktrees.open-it')}
                    className={iconButton}
                  >
                    <FolderOpen className="size-4" />
                  </button>
                )}
                {!w.main && !w.current && (
                  <button
                    onClick={() => remove(w)}
                    disabled={busy || w.locked}
                    title={t('worktrees.remove')}
                    aria-label={t('worktrees.remove')}
                    className={`${iconButton} hover:text-removed`}
                  >
                    <Trash2 className="size-4" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}

        <form onSubmit={add} className="space-y-3">
          <div className="flex gap-2">
            <label className="block min-w-0 flex-1">
              <span className="mb-1 block text-muted">
                {t('worktrees.branch')}
              </span>
              <select
                value={picked}
                onChange={(e) => setPicked(e.target.value)}
                className={input}
              >
                <option value={NEW}>{t('worktrees.new-branch')}</option>
                {free.map((b) => (
                  <option key={b.name} value={b.name}>
                    {b.name}
                  </option>
                ))}
              </select>
            </label>
            {picked === NEW && (
              <label className="block min-w-0 flex-1">
                <span className="mb-1 block text-muted">
                  {t('repocommands.name')}
                </span>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="feature/x"
                  className={input}
                />
              </label>
            )}
          </div>
          <label className="block">
            <span className="mb-1 block text-muted">
              {t('worktrees.folder')}
            </span>
            <span className="flex gap-2">
              <input
                value={path}
                onChange={(e) => setFolder(e.target.value)}
                className={input}
              />
              <button
                type="button"
                onClick={browse}
                className="shrink-0 rounded border border-line px-3 hover:bg-hover"
              >
                {t('clonedialog.browse')}
              </button>
            </span>
          </label>
          {error && (
            <p className="whitespace-pre-wrap text-removed select-text">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={busy || !branch || !path.trim()}
            className="flex w-full items-center justify-center gap-2 rounded bg-accent py-2 font-medium text-on-accent hover:opacity-90 disabled:opacity-40"
          >
            {busy && <Loader2 className="size-4 animate-spin" />}
            {t('worktrees.add')}
          </button>
        </form>
      </div>
    </Dialog>
  )
}
