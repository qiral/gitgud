import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'

interface Props {
  title: string
  onClose: () => void
  children: React.ReactNode
  wide?: boolean
  size?: 'lg' | 'xl'
}

export default function Dialog({
  title,
  onClose,
  children,
  wide,
  size,
}: Props) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      const open = document.querySelectorAll(
        '[role="dialog"][aria-modal="true"]',
      )
      if (open.length > 0 && open[open.length - 1] !== ref.current) return
      onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/50"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`${size === 'xl' ? 'w-[58rem]' : size === 'lg' ? 'w-[44rem]' : wide ? 'w-[32rem]' : 'w-96'} flex max-h-[calc(100vh-2rem)] max-w-[calc(100vw-2rem)] flex-col rounded-lg border border-line bg-panel text-left shadow-xl`}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-line px-4 py-3">
          <h2 className="font-semibold">{title}</h2>
          <button onClick={onClose} className="text-muted hover:text-fg">
            <X className="size-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
      </div>
    </div>
  )
}
