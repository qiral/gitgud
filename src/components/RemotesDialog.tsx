import { useEffect, useState } from 'react'
import { confirm } from '@tauri-apps/plugin-dialog'
import {
  GitFork,
  Globe,
  Loader2,
  Pencil,
  RefreshCw,
  Trash2,
} from 'lucide-react'
import {
  errorMessage,
  git,
  github,
  type Parent,
  type Remote,
  type RepoInfo,
} from '../lib/git'
import {
  FETCH_INTERVALS,
  maskUrl,
  readPrune,
  setFetchEvery,
  useFetchEvery,
  writePrune,
} from '../lib/remotes'
import Dialog from './Dialog'
import { useTranslation } from '../i18n'

interface Props {
  repo: RepoInfo
  remotes: Remote[]
  signedIn: boolean
  /** Reloads the repository, including `remotes`. */
  onChanged: () => Promise<unknown>
  onClose: () => void
}

/** Lists the remotes and adds, edits, fetches and removes them. */
export default function RemotesDialog({
  repo,
  remotes,
  signedIn,
  onChanged,
  onClose,
}: Props) {
  const { t } = useTranslation()
  const [editing, setEditing] = useState<Remote | null>(null)
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  /** What is running: "save", or "fetch:" and the remote's name. */
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [prune, setPrune] = useState(readPrune)
  const fetchEvery = useFetchEvery()
  const [parent, setParent] = useState<Parent | null>(null)

  // Forks get offered their parent, until a remote points at it.
  const urls = remotes.map((r) => r.url).join('\n')
  useEffect(() => {
    let cancelled = false
    setParent(null)
    if (signedIn)
      github
        .parent(repo.path)
        .then((p) => !cancelled && setParent(p))
        // Offline or no access: just no shortcut.
        .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [repo.path, signedIn, urls])

  async function run(label: string, action: () => Promise<unknown>) {
    setBusy(label)
    setError(null)
    try {
      await action()
      return true
    } catch (e) {
      setError(errorMessage(e))
      return false
    } finally {
      // Part of it may have worked even when it failed.
      await onChanged()
      setBusy(null)
    }
  }

  function edit(remote: Remote | null) {
    setEditing(remote)
    setName(remote?.name ?? '')
    setUrl(remote?.url ?? '')
    setError(null)
  }

  const fetch = (remote: string) =>
    run(`fetch:${remote}`, () => git.fetch(repo.path, remote, prune))

  async function add(newName: string, newUrl: string) {
    const added = await run('save', () =>
      git.addRemote(repo.path, newName, newUrl),
    )
    if (!added) return
    edit(null)
    // Its branches are what it was added for.
    await fetch(newName)
  }

  async function save(e: React.FormEvent) {
    e.preventDefault()
    const newName = name.trim()
    const newUrl = url.trim()
    if (!editing) return add(newName, newUrl)
    // The name last: until then `editing` still names the remote on a retry.
    const saved = await run('save', async () => {
      if (newUrl !== editing.url)
        await git.setRemoteUrl(repo.path, editing.name, newUrl)
      if (newName !== editing.name)
        await git.renameRemote(repo.path, editing.name, newName)
    })
    if (saved) edit(null)
  }

  async function remove(remote: Remote) {
    const ok = await confirm(
      t('remotesdialog.remove-body', { name: remote.name }),
      {
        title: t('remotesdialog.remove-title'),
        kind: 'warning',
        okLabel: t('remotesdialog.remove'),
      },
    )
    if (!ok) return
    if (editing?.name === remote.name) edit(null)
    await run('remove', () => git.removeRemote(repo.path, remote.name))
  }

  // "upstream" is the usual name, unless it's taken by something else.
  const parentName = remotes.some((r) => r.name === 'upstream')
    ? parent?.fullName.split('/')[0]
    : 'upstream'
  const input =
    'w-full rounded border border-line bg-bg px-2 py-1.5 outline-none focus:border-accent'
  const iconButton =
    'rounded p-1 text-muted hover:bg-hover hover:text-fg disabled:opacity-40'
  const unchanged =
    editing && name.trim() === editing.name && url.trim() === editing.url

  return (
    <Dialog title={t('remotesdialog.title')} onClose={onClose} wide>
      <div className="space-y-4">
        {remotes.length > 0 ? (
          <ul className="max-h-60 overflow-auto rounded-md border border-line">
            {remotes.map((r) => (
              <li
                key={r.name}
                className="flex items-center gap-3 border-b border-line px-3 py-2 last:border-b-0"
              >
                <Globe className="size-4 shrink-0 text-muted" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{r.name}</span>
                  <span className="block truncate text-xs text-muted select-text">
                    {maskUrl(r.url)}
                  </span>
                  {r.pushUrl && (
                    <span className="block truncate text-xs text-muted select-text">
                      {t('remotesdialog.pushes-to', {
                        url: maskUrl(r.pushUrl),
                      })}
                    </span>
                  )}
                </span>
                <button
                  onClick={() => fetch(r.name)}
                  disabled={busy !== null}
                  title={t('remotesdialog.fetch-remote', { name: r.name })}
                  className={iconButton}
                >
                  {busy === `fetch:${r.name}` ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <RefreshCw className="size-4" />
                  )}
                </button>
                <button
                  onClick={() => edit(r)}
                  disabled={busy !== null}
                  title={t('remotesdialog.edit-remote', { name: r.name })}
                  className={iconButton}
                >
                  <Pencil className="size-4" />
                </button>
                <button
                  onClick={() => remove(r)}
                  disabled={busy !== null}
                  title={t('remotesdialog.remove-remote', { name: r.name })}
                  className={`${iconButton} hover:text-removed`}
                >
                  <Trash2 className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted">{t('remotesdialog.empty')}</p>
        )}

        {parent && parentName && (
          <button
            onClick={() => add(parentName, parent.url)}
            disabled={busy !== null}
            className="flex w-full items-center gap-2 rounded border border-line px-3 py-2 text-left hover:bg-hover disabled:opacity-40"
          >
            <GitFork className="size-4 shrink-0 text-accent" />
            <span className="min-w-0 truncate">
              {t('remotesdialog.add-parent', {
                repo: parent.fullName,
                name: parentName,
              })}
            </span>
          </button>
        )}

        <form onSubmit={save} className="space-y-3">
          <div className="flex gap-2">
            <label className="block w-32">
              <span className="mb-1 block text-muted">
                {t('remotesdialog.name')}
              </span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="upstream"
                className={input}
              />
            </label>
            <label className="block min-w-0 flex-1">
              <span className="mb-1 block text-muted">
                {t('remotesdialog.url')}
              </span>
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://github.com/owner/repo.git"
                className={input}
              />
            </label>
          </div>
          {error && (
            <p className="whitespace-pre-wrap text-removed select-text">
              {error}
            </p>
          )}
          <div className="flex gap-2">
            {editing && (
              <button
                type="button"
                onClick={() => edit(null)}
                className="flex-1 rounded border border-line py-2 hover:bg-hover"
              >
                {t('remotesdialog.cancel')}
              </button>
            )}
            <button
              type="submit"
              disabled={
                busy !== null || !name.trim() || !url.trim() || !!unchanged
              }
              className="flex flex-1 items-center justify-center gap-2 rounded bg-accent py-2 font-medium text-on-accent hover:opacity-90 disabled:opacity-40"
            >
              {busy === 'save' && <Loader2 className="size-4 animate-spin" />}
              {editing ? t('remotesdialog.save') : t('remotesdialog.add')}
            </button>
          </div>
        </form>

        <label className="flex items-center gap-2 border-t border-line pt-3 text-muted">
          <input
            type="checkbox"
            checked={prune}
            onChange={(e) => {
              setPrune(e.target.checked)
              writePrune(e.target.checked)
            }}
          />
          {t('remotesdialog.prune')}
        </label>
        <label className="-mt-1 flex items-center gap-2 text-muted">
          {t('remotesdialog.auto-fetch')}
          <select
            value={fetchEvery}
            onChange={(e) => setFetchEvery(Number(e.target.value))}
            className="min-w-0 rounded border border-line bg-panel px-1 py-0.5 text-fg"
          >
            {FETCH_INTERVALS.map((m) => (
              <option key={m} value={m}>
                {m === 0
                  ? t('remotesdialog.auto-fetch-off')
                  : t('remotesdialog.auto-fetch-every', { minutes: m })}
              </option>
            ))}
          </select>
        </label>
      </div>
    </Dialog>
  )
}
