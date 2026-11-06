import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { errorMessage, github, type RepoInfo } from '../lib/git'
import Dialog from './Dialog'

interface Props {
  repo: RepoInfo
  onClose: () => void
  onPublished: () => void
}

/** Creates a repository on GitHub and pushes the current branch to it. */
export default function PublishDialog({ repo, onClose, onPublished }: Props) {
  const [name, setName] = useState(repo.name)
  const [description, setDescription] = useState('')
  const [isPrivate, setIsPrivate] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function publish(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await github.publish(
        repo.path,
        name.trim(),
        description.trim(),
        isPrivate,
      )
      onPublished()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const input =
    'w-full rounded border border-line bg-bg px-2 py-1.5 outline-none focus:border-accent'

  return (
    <Dialog title="Publish to GitHub" onClose={onClose}>
      <form onSubmit={publish} className="space-y-3">
        <label className="block">
          <span className="mb-1 block text-muted">Name</span>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={input}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-muted">Description (optional)</span>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className={input}
          />
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={isPrivate}
            onChange={(e) => setIsPrivate(e.target.checked)}
            className="accent-accent"
          />
          Keep this repository private
        </label>
        {error && <p className="text-removed select-text">{error}</p>}
        <button
          type="submit"
          disabled={busy || !name.trim()}
          className="flex w-full items-center justify-center gap-2 rounded bg-accent py-2 font-medium text-on-accent hover:opacity-90 disabled:opacity-40"
        >
          {busy && <Loader2 className="size-4 animate-spin" />}
          Publish repository
        </button>
      </form>
    </Dialog>
  )
}
