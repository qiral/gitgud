import { useEffect, useId, useState } from 'react'
import { openUrl } from '@tauri-apps/plugin-opener'
import { ExternalLink, Loader2, Server, Trash2 } from 'lucide-react'
import { errorMessage, hosts, type Host, type HostKind } from '../lib/git'
import { guessHostKind, tokenPageUrl } from '../lib/url'
import Dialog from './Dialog'

interface Props {
  onClose: () => void
}

const KINDS: { value: HostKind; label: string }[] = [
  { value: 'gitlab', label: 'GitLab' },
  { value: 'gitea', label: 'Gitea / Forgejo' },
  { value: 'other', label: 'Other' },
]

/** Sign in to GitLab, Gitea and other hosts with a personal access token. */
export default function HostsDialog({ onClose }: Props) {
  const [list, setList] = useState<Host[] | null>(null)
  const [url, setUrl] = useState('')
  const [kind, setKind] = useState<HostKind>('gitlab')
  const [username, setUsername] = useState('')
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const tokenId = useId()

  useEffect(() => {
    hosts
      .list()
      .then(setList)
      .catch((e) => {
        setList([])
        setError(errorMessage(e))
      })
  }, [])

  function changeUrl(value: string) {
    setUrl(value)
    const guess = guessHostKind(value)
    if (guess) setKind(guess)
  }

  async function add(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const host = await hosts.add(url, kind, username, token)
      setList((l) => [...(l ?? []).filter((h) => h.url !== host.url), host])
      setUrl('')
      setUsername('')
      setToken('')
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  async function remove(host: Host) {
    setError(null)
    try {
      await hosts.remove(host.url)
      setList((l) => (l ?? []).filter((h) => h.url !== host.url))
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  const tokenPage = tokenPageUrl(url, kind)
  const input =
    'w-full rounded border border-line bg-bg px-2 py-1.5 outline-none focus:border-accent'
  const canAdd =
    url.trim() && token.trim() && (kind !== 'other' || username.trim())

  return (
    <Dialog title="Other Git hosts" onClose={onClose} wide>
      <div className="space-y-4">
        {list === null ? (
          <div className="flex justify-center py-2 text-muted">
            <Loader2 className="size-4 animate-spin" />
          </div>
        ) : list.length > 0 ? (
          <ul className="overflow-hidden rounded-md border border-line">
            {list.map((h) => (
              <li
                key={h.url}
                className="flex items-center gap-3 border-b border-line px-3 py-2 last:border-b-0"
              >
                <Server className="size-4 shrink-0 text-muted" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{h.url}</span>
                  <span className="block truncate text-xs text-muted">
                    @{h.login}
                  </span>
                </span>
                <button
                  onClick={() => remove(h)}
                  title="Sign out of this host"
                  className="rounded p-1 text-muted hover:bg-hover hover:text-removed"
                >
                  <Trash2 className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted">
            Sign in to GitLab, Gitea, Forgejo or any other server with a
            personal access token. GitGud only sends it to that server.
          </p>
        )}

        <form onSubmit={add} className="space-y-3">
          <div className="flex gap-2">
            <label className="block flex-1">
              <span className="mb-1 block text-muted">Server address</span>
              <input
                autoFocus
                value={url}
                onChange={(e) => changeUrl(e.target.value)}
                placeholder="gitlab.com"
                className={input}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-muted">Type</span>
              <select
                value={kind}
                onChange={(e) => setKind(e.target.value as HostKind)}
                className={input}
              >
                {KINDS.map((k) => (
                  <option key={k.value} value={k.value}>
                    {k.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {kind === 'other' && (
            <label className="block">
              <span className="mb-1 block text-muted">Username</span>
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className={input}
              />
            </label>
          )}
          <div>
            <div className="mb-1 flex items-center justify-between text-muted">
              <label htmlFor={tokenId}>Personal access token</label>
              {tokenPage && (
                <button
                  type="button"
                  onClick={() => openUrl(tokenPage)}
                  className="flex items-center gap-1 text-xs text-accent hover:underline"
                >
                  Create one
                  <ExternalLink className="size-3" />
                </button>
              )}
            </div>
            <input
              id={tokenId}
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              className={input}
            />
          </div>
          {error && <p className="text-removed select-text">{error}</p>}
          <button
            type="submit"
            disabled={busy || !canAdd}
            className="flex w-full items-center justify-center gap-2 rounded bg-accent py-2 font-medium text-white hover:opacity-90 disabled:opacity-40"
          >
            {busy && <Loader2 className="size-4 animate-spin" />}
            Sign in
          </button>
        </form>
      </div>
    </Dialog>
  )
}
