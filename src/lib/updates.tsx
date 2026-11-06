import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react'
import {
  check as checkForUpdate,
  type Update,
} from '@tauri-apps/plugin-updater'
import { getVersion } from '@tauri-apps/api/app'
import { errorMessage } from './git'

/** How often a running app looks for a new release on its own. */
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000

type Status = 'idle' | 'checking' | 'upToDate' | 'error'

interface Updates {
  /** A newer release, once one was found. */
  update: Update | null
  /** This app's version, e.g. "0.6.1". */
  version: string | null
  status: Status
  error: string | null
  /** Whether the "new version" card is showing. */
  cardOpen: boolean
  openCard: () => void
  closeCard: () => void
  /** Looks for a release now. A manual check also reports "up to date". */
  check: (manual?: boolean) => Promise<void>
}

const UpdatesContext = createContext<Updates | null>(null)

export function useUpdates() {
  const value = useContext(UpdatesContext)
  if (!value) throw new Error('useUpdates needs an <UpdatesProvider>')
  return value
}

/**
 * Keeps track of new releases for the whole app: checks at startup and
 * every few hours, and whenever the user asks. Never installs anything by
 * itself; see UpdateNotice for that.
 */
export function UpdatesProvider({
  children,
  // Off in `npm run tauri dev`, where there is nothing to update.
  autoCheck = !import.meta.env.DEV,
}: {
  children: React.ReactNode
  autoCheck?: boolean
}) {
  const [update, setUpdate] = useState<Update | null>(null)
  const [version, setVersion] = useState<string | null>(null)
  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState<string | null>(null)
  const [cardOpen, setCardOpen] = useState(false)
  const shown = useRef<string | null>(null)

  useEffect(() => {
    getVersion()
      .then(setVersion)
      .catch(() => {})
  }, [])

  const check = useCallback(async (manual = false) => {
    setStatus('checking')
    setError(null)
    try {
      const found = await checkForUpdate()
      setUpdate(found)
      setStatus(found ? 'idle' : manual ? 'upToDate' : 'idle')
      // Pop the card up once per new version, and always when asked.
      if (found && (manual || shown.current !== found.version)) {
        shown.current = found.version
        setCardOpen(true)
      }
    } catch (e) {
      // Offline or GitHub down: stay quiet unless the user asked.
      setStatus(manual ? 'error' : 'idle')
      if (manual) setError(errorMessage(e))
    }
  }, [])

  useEffect(() => {
    if (!autoCheck) return
    check()
    const timer = setInterval(() => check(), CHECK_EVERY_MS)
    return () => clearInterval(timer)
  }, [autoCheck, check])

  // "Up to date" is only worth a glance.
  useEffect(() => {
    if (status !== 'upToDate') return
    const t = setTimeout(() => setStatus('idle'), 4000)
    return () => clearTimeout(t)
  }, [status])

  return (
    <UpdatesContext.Provider
      value={{
        update,
        version,
        status,
        error,
        cardOpen,
        openCard: () => setCardOpen(true),
        closeCard: () => {
          setCardOpen(false)
          setStatus((s) => (s === 'error' ? 'idle' : s))
        },
        check,
      }}
    >
      {children}
    </UpdatesContext.Provider>
  )
}
