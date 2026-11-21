import { useState } from 'react'
import { listen } from '@tauri-apps/api/event'
import { Loader2 } from 'lucide-react'
import { copilot, errorMessage } from '../lib/git'
import Dialog from './Dialog'

interface Props {
  onInstalled: () => void
  onClose: () => void
}

/** Offers to download the Copilot CLI when there is none. */
export default function CopilotSetupDialog({ onInstalled, onClose }: Props) {
  const [percent, setPercent] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const downloading = percent !== null

  async function download() {
    setError(null)
    setPercent(0)
    const unlisten = await listen<{ percent: number }>(
      'copilot-progress',
      (event) => setPercent(event.payload.percent),
    )
    try {
      await copilot.install()
      onInstalled()
    } catch (e) {
      setError(errorMessage(e))
      setPercent(null)
    } finally {
      unlisten()
    }
  }

  return (
    // Closing mid-download would hide progress while it keeps running.
    <Dialog
      title="Set up GitHub Copilot"
      onClose={() => !downloading && onClose()}
    >
      <div className="space-y-4">
        <p>
          GitGud uses the GitHub Copilot CLI for this, and it isn't installed.
          GitGud can download it once (about 110 MB) into its own folder.
        </p>
        {downloading && (
          <div className="space-y-1">
            <div className="flex justify-between text-xs text-muted">
              <span>Downloading…</span>
              <span>{percent}%</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded bg-bg">
              <div
                className="h-full bg-accent transition-[width]"
                style={{ width: `${percent}%` }}
              />
            </div>
          </div>
        )}
        {error && (
          <pre className="font-mono text-xs whitespace-pre-wrap text-removed select-text">
            {error}
          </pre>
        )}
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={downloading}
            className="rounded border border-line px-3 py-1.5 hover:bg-hover disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            onClick={download}
            disabled={downloading}
            className="flex items-center gap-2 rounded bg-accent px-3 py-1.5 font-medium text-on-accent hover:opacity-90 disabled:opacity-40"
          >
            {downloading && <Loader2 className="size-4 animate-spin" />}
            Download
          </button>
        </div>
      </div>
    </Dialog>
  )
}
