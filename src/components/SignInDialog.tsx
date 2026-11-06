import { useEffect, useRef, useState } from 'react'
import { openUrl } from '@tauri-apps/plugin-opener'
import { ExternalLink, Loader2 } from 'lucide-react'
import { errorMessage, github, type Account, type DeviceCode } from '../lib/git'
import Dialog from './Dialog'

interface Props {
  onClose: () => void
  onSignedIn: (account: Account) => void
}

/** GitHub device flow: show a code, the user enters it on github.com. */
export default function SignInDialog({ onClose, onSignedIn }: Props) {
  const [code, setCode] = useState<DeviceCode | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  // Kept in a ref so a new callback from the parent doesn't restart sign-in.
  const onSignedInRef = useRef(onSignedIn)
  onSignedInRef.current = onSignedIn

  useEffect(() => {
    let cancelled = false
    let timer: number | undefined

    async function poll(deviceCode: string, interval: number) {
      if (cancelled) return
      try {
        const result = await github.pollSignIn(deviceCode, interval)
        if (cancelled) return
        if (result.state === 'done') onSignedInRef.current(result.account)
        else if (result.state === 'failed') setError(result.message)
        else
          timer = window.setTimeout(
            () => poll(deviceCode, result.interval),
            result.interval * 1000,
          )
      } catch (e) {
        if (!cancelled) setError(errorMessage(e))
      }
    }

    setCode(null)
    setError(null)
    github
      .startSignIn()
      .then((c) => {
        if (cancelled) return
        setCode(c)
        timer = window.setTimeout(
          () => poll(c.deviceCode, c.interval),
          c.interval * 1000,
        )
      })
      .catch((e) => !cancelled && setError(errorMessage(e)))

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [attempt])

  async function openGitHub() {
    if (!code) return
    try {
      await navigator.clipboard.writeText(code.userCode)
    } catch {
      // The code is on screen; copying is only a convenience.
    }
    await openUrl(code.verificationUri)
  }

  return (
    <Dialog title="Sign in to GitHub" onClose={onClose}>
      {error ? (
        <div className="space-y-4">
          <p className="text-removed">{error}</p>
          <button
            onClick={() => setAttempt((a) => a + 1)}
            className="w-full rounded bg-accent py-2 font-medium text-on-accent hover:opacity-90"
          >
            Try again
          </button>
        </div>
      ) : !code ? (
        <div className="flex justify-center py-6 text-muted">
          <Loader2 className="size-5 animate-spin" />
        </div>
      ) : (
        <div className="space-y-4 text-center">
          <p className="text-muted">
            Enter this code on GitHub to connect your account:
          </p>
          <p className="font-mono text-3xl font-bold tracking-widest select-text">
            {code.userCode}
          </p>
          <button
            onClick={openGitHub}
            className="flex w-full items-center justify-center gap-2 rounded bg-accent py-2 font-medium text-on-accent hover:opacity-90"
          >
            Copy code and open GitHub
            <ExternalLink className="size-4" />
          </button>
          <p className="flex items-center justify-center gap-2 text-xs text-muted">
            <Loader2 className="size-3 animate-spin" />
            Waiting for you to approve on GitHub…
          </p>
        </div>
      )}
    </Dialog>
  )
}
