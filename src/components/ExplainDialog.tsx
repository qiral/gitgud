import { Loader2 } from 'lucide-react'
import Dialog from './Dialog'

interface Props {
  title: string
  /** Null while Copilot is still answering. */
  explanation: string | null
  onClose: () => void
}

export default function ExplainDialog({ title, explanation, onClose }: Props) {
  return (
    <Dialog title={`Explain ${title}`} onClose={onClose} wide>
      {explanation === null ? (
        <div
          role="status"
          aria-label="Asking Copilot"
          className="flex justify-center py-8 text-muted"
        >
          <Loader2 className="size-5 animate-spin" />
        </div>
      ) : (
        <div className="max-h-[60vh] overflow-auto whitespace-pre-wrap select-text">
          {explanation}
        </div>
      )}
    </Dialog>
  )
}
