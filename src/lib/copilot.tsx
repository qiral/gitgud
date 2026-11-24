import { useCallback, useState } from 'react'
import CopilotSetupDialog from '../components/CopilotSetupDialog'
import { COPILOT_MISSING, errorMessage } from './git'

/** Runs Copilot requests, which need the GitHub sign-in. When the CLI is
 *  missing it offers to download it and tries again; other errors go to
 *  `setError` and resolve to null. With `quiet` the error bar is left alone
 *  and errors reject instead, e.g. while explaining the error shown there. */
export function useCopilot(
  setError: (e: string | null) => void,
  signedIn: boolean,
  onSignIn: () => void,
) {
  const [setup, setSetup] = useState<((ok: boolean) => void) | null>(null)

  const run = useCallback(
    async <T,>(
      task: () => Promise<T>,
      { quiet = false } = {},
    ): Promise<T | null> => {
      if (!quiet) setError(null)
      if (!signedIn) {
        onSignIn()
        return null
      }
      try {
        try {
          return await task()
        } catch (e) {
          if (errorMessage(e) !== COPILOT_MISSING) throw e
          const installed = await new Promise<boolean>((resolve) =>
            setSetup(() => resolve),
          )
          setSetup(null)
          return installed ? await task() : null
        }
      } catch (e) {
        if (quiet) throw e
        setError(errorMessage(e))
        return null
      }
    },
    [setError, signedIn, onSignIn],
  )

  const dialog = setup && (
    <CopilotSetupDialog
      onInstalled={() => setup(true)}
      onClose={() => setup(false)}
    />
  )
  return { run, dialog }
}
