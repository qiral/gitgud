import { Loader2 } from 'lucide-react'
import Dialog from './Dialog'
import CopyButton from './CopyButton'
import { useTranslation } from '../i18n'

interface Props {
  /** The whole heading, e.g. "Explain abc1234". */
  title: string
  /** Null while Copilot is still answering. */
  explanation: string | null
  onClose: () => void
}

export default function ExplainDialog({ title, explanation, onClose }: Props) {
  const { t } = useTranslation()
  return (
    <Dialog title={title} onClose={onClose} wide>
      {explanation === null ? (
        <div
          role="status"
          aria-label={t('explaindialog.asking-copilot')}
          className="flex justify-center py-8 text-muted"
        >
          <Loader2 className="size-5 animate-spin" />
        </div>
      ) : (
        <div className="relative">
          <div className="absolute top-0 right-0">
            <CopyButton text={explanation} title={t('explaindialog.copy')} />
          </div>
          <div className="max-h-[60vh] overflow-auto pr-8 whitespace-pre-wrap select-text">
            {explanation}
          </div>
        </div>
      )}
    </Dialog>
  )
}
