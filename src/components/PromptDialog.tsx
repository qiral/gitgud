import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import Dialog from './Dialog'

interface Props {
  title: string
  label: string
  /** Shown above the field, e.g. what the action does. */
  description?: React.ReactNode
  initial?: string
  placeholder?: string
  submitLabel: string
  /** Extra fields under the main one, e.g. an optional message. */
  children?: React.ReactNode
  /** Resolves to true when done, which closes the dialog. */
  onSubmit: (value: string) => Promise<boolean>
  onClose: () => void
}

/** Asks for a single name, e.g. for renaming a branch or creating a tag. */
export default function PromptDialog({
  title,
  label,
  description,
  initial = '',
  placeholder,
  submitLabel,
  children,
  onSubmit,
  onClose,
}: Props) {
  const [value, setValue] = useState(initial)
  const [busy, setBusy] = useState(false)
  const trimmed = value.trim()

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!trimmed || busy) return
    setBusy(true)
    const done = await onSubmit(trimmed)
    setBusy(false)
    if (done) onClose()
  }

  return (
    <Dialog title={title} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        {description && <p className="text-muted">{description}</p>}
        <label className="block">
          <span className="mb-1 block text-muted">{label}</span>
          <input
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onFocus={(e) => e.target.select()}
            placeholder={placeholder}
            className="w-full rounded border border-line bg-bg px-2 py-1.5 outline-none focus:border-accent"
          />
        </label>
        {children}
        <button
          type="submit"
          disabled={busy || !trimmed || trimmed === initial}
          className="flex w-full items-center justify-center gap-2 rounded bg-accent py-2 font-medium text-on-accent hover:opacity-90 disabled:opacity-40"
        >
          {busy && <Loader2 className="size-4 animate-spin" />}
          {submitLabel}
        </button>
      </form>
    </Dialog>
  )
}
