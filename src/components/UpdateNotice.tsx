import { useEffect, useState } from 'react'
import { check, type Update } from '@tauri-apps/plugin-updater'
import { relaunch } from '@tauri-apps/plugin-process'
import { openUrl } from '@tauri-apps/plugin-opener'
import { Download, Loader2, X } from 'lucide-react'
import { errorMessage } from '../lib/git'

const RELEASES = 'https://github.com/qiral/gitgud/releases'

interface Props {
  /** Off in `npm run tauri dev`, where there is nothing to update. */
  enabled?: boolean
}

/**
 * Checks GitHub for a newer release once at startup and offers to install it.
 * Never updates without the user clicking.
 */
export default function UpdateNotice({
  enabled = !import.meta.env.DEV,
}: Props) {
  const [update, setUpdate] = useState<Update | null>(null)
  const [dismissed, setDismissed] = useState(false)
  // null while idle, 0-100 while downloading.
  const [percent, setPercent] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    // Offline or GitHub down: just try again next launch.
    check()
      .then((u) => !cancelled && setUpdate(u))
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [enabled])

  if (!update || dismissed) return null

  async function install() {
    if (!update) return
    setError(null)
    setPercent(0)
    let total = 0
    let done = 0
    try {
      await update.downloadAndInstall((event) => {
        if (event.event === 'Started') total = event.data.contentLength ?? 0
        else if (event.event === 'Progress') {
          done += event.data.chunkLength
          if (total) setPercent(Math.min(100, Math.round((done / total) * 100)))
        }
      })
      await relaunch()
    } catch (e) {
      setPercent(null)
      setError(errorMessage(e))
    }
  }

  const releasePage = `${RELEASES}/tag/v${update.version}`
  const installing = percent !== null

  return (
    <div className="fixed right-4 bottom-4 z-30 w-80 rounded-lg border border-line bg-panel p-4 shadow-xl">
      <div className="flex items-start gap-3">
        <Download className="mt-0.5 size-4 shrink-0 text-accent" />
        <div className="min-w-0 flex-1">
          <p className="font-medium">GitGud {update.version} is available</p>
          <p className="text-xs text-muted">
            You have {update.currentVersion}.{' '}
            <button
              onClick={() => openUrl(releasePage)}
              className="text-accent hover:underline"
            >
              What's new
            </button>
          </p>
        </div>
        {!installing && (
          <button
            onClick={() => setDismissed(true)}
            title="Later"
            className="text-muted hover:text-fg"
          >
            <X className="size-4" />
          </button>
        )}
      </div>
      {error && (
        <p className="mt-3 text-xs text-removed select-text">
          {error}{' '}
          <button
            onClick={() => openUrl(releasePage)}
            className="text-accent hover:underline"
          >
            Download it manually
          </button>
        </p>
      )}
      <button
        onClick={install}
        disabled={installing}
        className="mt-3 flex w-full items-center justify-center gap-2 rounded bg-accent py-1.5 font-medium text-white hover:opacity-90 disabled:opacity-60"
      >
        {installing && <Loader2 className="size-4 animate-spin" />}
        {installing ? `Downloading… ${percent}%` : 'Update and restart'}
      </button>
    </div>
  )
}
