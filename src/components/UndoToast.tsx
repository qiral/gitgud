import { useEffect, useState } from 'react'
import { Undo2, X } from 'lucide-react'
import type { Undoable } from '../lib/git'
import { useTranslation } from '../i18n'

const SHOWN_MS = 10_000

/** Ids only grow, so going back to an older one isn't a new action. Kept here
 *  so reopening a repository doesn't show old ones again. */
let seen = 0

interface Props {
  undoable: Undoable | null
  disabled: boolean
  onUndo: (id: number) => void
}

/** Offers to take back an action for a while after it was done. */
export default function UndoToast({ undoable, disabled, onUndo }: Props) {
  const { t } = useTranslation()
  const [shown, setShown] = useState<number | null>(null)
  const id = undoable?.id ?? null

  useEffect(() => {
    if (id === null || id <= seen) return
    seen = id
    setShown(id)
  }, [id])

  // On its own, so the time also runs out while there's nothing to undo,
  // e.g. during a merge.
  useEffect(() => {
    if (shown === null) return
    const timer = setTimeout(() => setShown(null), SHOWN_MS)
    return () => clearTimeout(timer)
  }, [shown])

  if (!undoable || shown !== undoable.id) return null
  return (
    <div
      role="status"
      className="fixed bottom-4 left-1/2 z-30 flex -translate-x-1/2 items-center gap-3 rounded-md border border-line bg-panel px-4 py-2 shadow-lg"
    >
      <span>{t(`undo.done-${undoable.kind}`)}</span>
      <button
        onClick={() => onUndo(undoable.id)}
        disabled={disabled}
        className="flex items-center gap-1.5 font-medium text-accent hover:underline disabled:opacity-40"
      >
        <Undo2 className="size-4" />
        {t('undo.undo')}
      </button>
      <button
        onClick={() => setShown(null)}
        title={t('repoview.dismiss')}
        className="text-muted hover:text-fg"
      >
        <X className="size-4" />
      </button>
    </div>
  )
}
