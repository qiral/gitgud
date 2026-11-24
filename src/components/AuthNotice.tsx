import { AlertTriangle } from 'lucide-react'
import { useTranslation } from '../i18n'

interface Props {
  message: string
  onSignIn: () => void
  onDismiss: () => void
}

/** Tells the user their GitHub sign-in needs attention, on any screen. */
export default function AuthNotice({ message, onSignIn, onDismiss }: Props) {
  const { t } = useTranslation()
  return (
    <div
      role="status"
      className="fixed bottom-4 left-4 z-30 flex w-80 items-start gap-3 rounded-lg border border-line bg-panel p-4 shadow-xl"
    >
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-modified" />
      <div className="min-w-0 flex-1 space-y-2">
        <p>{message}</p>
        <div className="flex gap-3">
          <button
            onClick={onSignIn}
            className="font-medium text-accent hover:underline"
          >
            {t('authnotice.sign-in')}
          </button>
          <button onClick={onDismiss} className="text-muted hover:text-fg">
            {t('authnotice.dismiss')}
          </button>
        </div>
      </div>
    </div>
  )
}
