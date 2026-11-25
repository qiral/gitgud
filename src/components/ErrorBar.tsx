import { Sparkles } from 'lucide-react'
import { useTranslation } from '../i18n'

interface Props {
  error: string
  onDismiss: () => void
  /** Asks Copilot what the error means; unset to hide the button. */
  onExplain?: () => void
}

/** The last error, under everything else, until dismissed. */
export default function ErrorBar({ error, onDismiss, onExplain }: Props) {
  const { t } = useTranslation()
  return (
    <div className="flex max-h-36 shrink-0 items-start gap-3 border-t border-line bg-removed-bg px-4 py-2 text-removed">
      <pre className="max-h-32 min-w-0 flex-1 overflow-y-auto font-mono text-xs break-words whitespace-pre-wrap select-text">
        {error}
      </pre>
      {onExplain && (
        <button
          onClick={onExplain}
          className="flex shrink-0 items-center gap-1 hover:underline"
        >
          <Sparkles className="size-3.5" />
          {t('errorbar.explain-with-copilot')}
        </button>
      )}
      <button onClick={onDismiss} className="shrink-0 hover:underline">
        {t('repoview.dismiss')}
      </button>
    </div>
  )
}
