import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import type { LucideIcon } from 'lucide-react'

export type MenuItem =
  | {
      label: string
      icon?: LucideIcon
      onClick: () => void
      disabled?: boolean
      danger?: boolean
    }
  | 'separator'

interface Open {
  x: number
  y: number
  items: MenuItem[]
}

/**
 * A right-click menu. Render `menu` once somewhere in the component and call
 * `open` from an onContextMenu handler with the items to show.
 */
export function useContextMenu() {
  const [state, setState] = useState<Open | null>(null)
  const open = useCallback((e: React.MouseEvent, items: MenuItem[]) => {
    e.preventDefault()
    e.stopPropagation()
    setState({ x: e.clientX, y: e.clientY, items })
  }, [])
  const close = useCallback(() => setState(null), [])
  const menu = state ? <Menu {...state} onClose={close} /> : null
  return { menu, open }
}

function Menu({ x, y, items, onClose }: Open & { onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: x, top: y })

  // Keep the menu on screen when opened near the right or bottom edge.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    setPos({
      left: Math.max(4, Math.min(x, window.innerWidth - width - 4)),
      top: Math.max(4, Math.min(y, window.innerHeight - height - 4)),
    })
    el.focus()
  }, [x, y])

  useLayoutEffect(() => {
    const away = (e: Event) => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('mousedown', away, true)
    // Wheel rather than scroll: panes reset their own scroll position when
    // the right-click selects something, which mustn't close the menu.
    window.addEventListener('wheel', away, true)
    window.addEventListener('blur', onClose)
    window.addEventListener('resize', onClose)
    window.addEventListener('keydown', key)
    return () => {
      window.removeEventListener('mousedown', away, true)
      window.removeEventListener('wheel', away, true)
      window.removeEventListener('blur', onClose)
      window.removeEventListener('resize', onClose)
      window.removeEventListener('keydown', key)
    }
  }, [onClose])

  return (
    <div
      ref={ref}
      role="menu"
      tabIndex={-1}
      style={pos}
      onContextMenu={(e) => e.preventDefault()}
      className="fixed z-50 min-w-48 rounded-md border border-line bg-panel py-1 text-sm shadow-lg outline-none"
    >
      {items.map((item, i) =>
        item === 'separator' ? (
          <div key={i} className="my-1 border-t border-line" />
        ) : (
          <button
            key={i}
            role="menuitem"
            disabled={item.disabled}
            onClick={() => {
              onClose()
              item.onClick()
            }}
            className={`flex w-full items-center gap-2 px-3 py-1 text-left hover:bg-hover disabled:opacity-40 disabled:hover:bg-transparent ${
              item.danger ? 'text-removed' : ''
            }`}
          >
            {item.icon ? (
              <item.icon className="size-3.5 shrink-0 text-muted" />
            ) : (
              <span className="size-3.5 shrink-0" />
            )}
            {item.label}
          </button>
        ),
      )}
    </div>
  )
}
