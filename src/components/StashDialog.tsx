import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { git, type RepoInfo } from '../lib/git'
import Dialog from './Dialog'

interface Props {
  repo: RepoInfo
  onClose: () => void
  act: (label: string, action: () => Promise<unknown>) => Promise<boolean>
}

export default function StashDialog({ repo, onClose, act }: Props) {
  const [message, setMessage] = useState('')
  const [includeUntracked, setIncludeUntracked] = useState(true)
  const [busy, setBusy] = useState(false)

  async function stash(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    const ok = await act('stash', () =>
      git.stashPush(repo.path, message, includeUntracked),
    )
    setBusy(false)
    if (ok) onClose()
  }

  return (
    <Dialog title="Stash changes" onClose={onClose}>
      <form onSubmit={stash} className="space-y-3">
        <p className="text-muted">
          Set your uncommitted changes aside and get a clean working tree. You
          can bring them back from the Stashes tab.
        </p>
        <label className="block">
          <span className="mb-1 block text-muted">Message (optional)</span>
          <input
            autoFocus
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="What were you working on?"
            className="w-full rounded border border-line bg-bg px-2 py-1.5 outline-none focus:border-accent"
          />
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={includeUntracked}
            onChange={(e) => setIncludeUntracked(e.target.checked)}
            className="accent-accent"
          />
          Include new (untracked) files
        </label>
        <button
          type="submit"
          disabled={busy}
          className="flex w-full items-center justify-center gap-2 rounded bg-accent py-2 font-medium text-on-accent hover:opacity-90 disabled:opacity-40"
        >
          {busy && <Loader2 className="size-4 animate-spin" />}
          Stash changes
        </button>
      </form>
    </Dialog>
  )
}
