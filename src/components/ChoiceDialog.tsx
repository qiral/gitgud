import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import Dialog from './Dialog'

interface Props {
  title: string
  label: string
  options: { value: string; label: string }[]
  initial: string
  /** Choosing this one again would change nothing. */
  current?: string
  submitLabel: string
  /** Resolves to true when done, which closes the dialog. */
  onSubmit: (value: string) => Promise<boolean>
  onClose: () => void
}

/** Asks to pick one of a list, e.g. the remote to push to. */
export default function ChoiceDialog({
  title,
  label,
  options,
  initial,
  current,
  submitLabel,
  onSubmit,
  onClose,
}: Props) {
  const [value, setValue] = useState(initial)
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    const done = await onSubmit(value)
    setBusy(false)
    if (done) onClose()
  }

  return (
    <Dialog title={title} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <label className="block">
          <span className="mb-1 block text-muted">{label}</span>
          <select
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="w-full rounded border border-line bg-bg px-2 py-1.5 outline-none focus:border-accent"
          >
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          disabled={busy || value === current}
          className="flex w-full items-center justify-center gap-2 rounded bg-accent py-2 font-medium text-on-accent hover:opacity-90 disabled:opacity-40"
        >
          {busy && <Loader2 className="size-4 animate-spin" />}
          {submitLabel}
        </button>
      </form>
    </Dialog>
  )
}
