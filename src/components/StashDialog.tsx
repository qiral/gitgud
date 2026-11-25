import { useState } from 'react'
import { Loader2, Sparkles } from 'lucide-react'
import { git, type RepoInfo } from '../lib/git'
import Dialog from './Dialog'
import { useTranslation } from '../i18n'

interface Props {
  repo: RepoInfo
  onClose: () => void
  act: (label: string, action: () => Promise<unknown>) => Promise<boolean>
  /** Writes a message for the changes (with new files or not); null when
   *  it failed. Unset to hide the button. */
  onSuggest?: (includeUntracked: boolean) => Promise<string | null>
}

export default function StashDialog({ repo, onClose, act, onSuggest }: Props) {
  const { t } = useTranslation()
  const [message, setMessage] = useState('')
  const [includeUntracked, setIncludeUntracked] = useState(true)
  const [busy, setBusy] = useState(false)
  const [suggesting, setSuggesting] = useState(false)

  async function suggest() {
    if (!onSuggest) return
    setSuggesting(true)
    try {
      const suggestion = await onSuggest(includeUntracked)
      if (suggestion) setMessage(suggestion)
    } finally {
      setSuggesting(false)
    }
  }

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
    <Dialog title={t('stashdialog.stash-changes')} onClose={onClose}>
      <form onSubmit={stash} className="space-y-3">
        <p className="text-muted">
          {t(
            'stashdialog.set-your-uncommitted-changes-aside-and-get-a-clean-working-tree-you-can-bring-them-back-from-the-stashes-tab',
          )}
        </p>
        <label className="block">
          <span className="mb-1 block text-muted">
            {t('stashdialog.message-optional')}
          </span>
          <span className="relative block">
            <input
              autoFocus
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={t('stashdialog.what-were-you-working-on')}
              className={`w-full rounded border border-line bg-bg px-2 py-1.5 outline-none focus:border-accent ${onSuggest ? 'pr-8' : ''}`}
            />
            {onSuggest && (
              <button
                type="button"
                onClick={suggest}
                disabled={suggesting || busy}
                title={t('stashdialog.write-the-message-with-copilot')}
                aria-label={t('stashdialog.write-the-message-with-copilot')}
                className="absolute top-1/2 right-1.5 -translate-y-1/2 rounded p-1 text-muted hover:bg-hover hover:text-fg disabled:opacity-40"
              >
                {suggesting ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Sparkles className="size-4" />
                )}
              </button>
            )}
          </span>
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={includeUntracked}
            onChange={(e) => setIncludeUntracked(e.target.checked)}
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
