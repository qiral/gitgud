import { useEffect, useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { copyText } from '../lib/copy'

/** A small icon button that copies `text` and briefly shows a check mark. */
export default function CopyButton({
  text,
  title,
  label,
}: {
  text: string
  title: string
  /** Shown next to the icon, e.g. a short commit hash. */
  label?: string
}) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(false), 1200)
    return () => clearTimeout(t)
  }, [copied])

  const Icon = copied ? Check : Copy
  return (
    <button
      title={copied ? 'Copied' : title}
      onClick={async (e) => {
        e.stopPropagation()
        await copyText(text)
        setCopied(true)
      }}
      className="flex shrink-0 items-center gap-1 rounded px-1 py-0.5 text-muted hover:bg-hover hover:text-fg"
    >
      {label && <span className="font-mono text-xs">{label}</span>}
      <Icon className={`size-3.5 ${copied ? 'text-added' : ''}`} />
    </button>
  )
}
