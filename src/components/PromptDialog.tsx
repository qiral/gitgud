import { useState } from 'react'
import { Loader2, Sparkles } from 'lucide-react'
import Dialog from './Dialog'
import { useTranslation } from '../i18n'

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
  /** Turns what was typed, e.g. a description, into a suggested value;
   *  null when it failed. Unset to hide the button. */
  onSuggest?: (text: string) => Promise<string | null>
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
  onSuggest,
  onSubmit,
  onClose,
}: Props) {
  const { t } = useTranslation()
  const [value, setValue] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [suggesting, setSuggesting] = useState(false)
  const trimmed = value.trim()

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!trimmed || busy) return
    setBusy(true)
    const done = await onSubmit(trimmed)
    setBusy(false)
    if (done) onClose()
  }

  async function suggest() {
    if (!onSuggest || !trimmed) return
    setSuggesting(true)
    try {
      const suggestion = await onSuggest(trimmed)
      if (suggestion) setValue(suggestion)
    } finally {
      setSuggesting(false)
    }
  }

  return (
    <Dialog title={title} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        {description && <p className="text-muted">{description}</p>}
        <label className="block">
          <span className="mb-1 block text-muted">{label}</span>
          <span className="relative block">
            <input
              autoFocus
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onFocus={(e) => e.target.select()}
              placeholder={
                placeholder ??
                (onSuggest ? t('promptdialog.name-or-description') : undefined)
              }
              className={`w-full rounded border border-line bg-bg px-2 py-1.5 outline-none focus:border-accent ${onSuggest ? 'pr-8' : ''}`}
            />
            {onSuggest && (
              <button
                type="button"
                onClick={suggest}
                disabled={!trimmed || suggesting || busy}
                title={t('promptdialog.suggest-a-name-with-copilot')}
                aria-label={t('promptdialog.suggest-a-name-with-copilot')}
                className="absolute top-1/2 right-1.5 -translate-y-1/2 rounded p-1 text-muted hover:bg-hover hover:text-fg disabled:opacity-40"
              >
                {suggesting ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Sparkles className="size-4" />
                )}
              </button>
            )}
          </span>
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
