import { useState } from 'react'
import { relaunch } from '@tauri-apps/plugin-process'
import { openUrl } from '@tauri-apps/plugin-opener'
import { CircleCheck, Download, Loader2, TriangleAlert, X } from 'lucide-react'
import { errorMessage } from '../lib/git'
import { useUpdates } from '../lib/updates'

const RELEASES = 'https://github.com/qiral/gitgud/releases'

/**
 * The card in the corner that offers a new release, or answers a manual
 * "Check for updates". Never updates without the user clicking.
 */
export default function UpdateNotice() {
  const { update, version, status, error, cardOpen, closeCard } = useUpdates()
  // null while idle, 0-100 while downloading.
  const [percent, setPercent] = useState<number | null>(null)
  const [installError, setInstallError] = useState<string | null>(null)

  if (status === 'upToDate')
    return (
      <Card>
        <CircleCheck className="mt-0.5 size-4 shrink-0 text-added" />
        <div className="min-w-0 flex-1">
          <p className="font-medium">You're up to date</p>
          {version && (
            <p className="text-xs text-muted">
              GitGud {version} is the latest.
            </p>
          )}
        </div>
      </Card>
    )

  if (status === 'error')
    return (
      <Card>
        <TriangleAlert className="mt-0.5 size-4 shrink-0 text-modified" />
        <div className="min-w-0 flex-1">
          <p className="font-medium">Couldn't check for updates</p>
          <p className="text-xs text-muted select-text">
            {error}{' '}
            <button
              onClick={() => openUrl(`${RELEASES}/latest`)}
              className="text-accent hover:underline"
            >
              Open releases
            </button>
          </p>
        </div>
        <button
          onClick={closeCard}
          title="Close"
          className="text-muted hover:text-fg"
        >
          <X className="size-4" />
        </button>
      </Card>
    )

  if (!update || !cardOpen) return null

  async function install() {
    if (!update) return
    setInstallError(null)
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
      setInstallError(errorMessage(e))
    }
  }

  const releasePage = `${RELEASES}/tag/v${update.version}`
  const installing = percent !== null

  return (
    <Card>
      <div className="w-full">
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
              onClick={closeCard}
              title="Later"
              className="text-muted hover:text-fg"
            >
              <X className="size-4" />
            </button>
          )}
        </div>
        {installError && (
          <p className="mt-3 text-xs text-removed select-text">
            {installError}{' '}
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
          className="mt-3 flex w-full items-center justify-center gap-2 rounded bg-accent py-1.5 font-medium text-on-accent hover:opacity-90 disabled:opacity-60"
        >
          {installing && <Loader2 className="size-4 animate-spin" />}
          {installing ? `Downloading… ${percent}%` : 'Update and restart'}
        </button>
      </div>
    </Card>
  )
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div
      role="status"
      className="fixed right-4 bottom-4 z-30 flex w-80 items-start gap-3 rounded-lg border border-line bg-panel p-4 shadow-xl"
    >
      {children}
    </div>
  )
}
