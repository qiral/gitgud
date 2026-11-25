import { useCallback, useEffect, useRef, useState } from 'react'
import { readWidth, writeWidth } from '../lib/prefs'
import { useTranslation } from '../i18n'

/** Room always left for the diff next to a resized panel. */
const KEEP_FOR_REST = 360
const KEY_STEP = 16

interface Options {
  /** Remembers the width under this name. */
  key: string
  initial: number
  min: number
  max: number
  /** Room to reserve for sibling panes; defaults to KEEP_FOR_REST. */
  keepForRest?: number
}

/**
 * A panel width the user can drag. Returns the width to apply, a handle
 * to render inside the panel (which must be `relative`), and an optional
 * `containerRef` to clamp against the parent split container instead of
 * `window.innerWidth`. Double-clicking the handle goes back to the initial
 * width.
 */
export function useResizable({
  key,
  initial,
  min,
  max,
  keepForRest = KEEP_FOR_REST,
}: Options) {
  const [container, setContainer] = useState<HTMLElement | null>(null)
  const containerRef = useCallback((el: HTMLElement | null) => {
    setContainer(el)
  }, [])
  const preferred = useRef(readWidth(key, initial))

  const clamp = useCallback(
    (w: number) => {
      const avail =
        container && container.clientWidth > 0
          ? container.clientWidth
          : window.innerWidth
      return Math.round(Math.max(min, Math.min(w, max, avail - keepForRest)))
    },
    [min, max, keepForRest, container],
  )
  const [width, setWidth] = useState(() => clamp(preferred.current))

  // Different panels (e.g. the Changes and History sidebars) share a spot
  // but keep their own widths.
  useEffect(() => {
    preferred.current = readWidth(key, initial)
    setWidth(clamp(preferred.current))
  }, [key, initial, clamp])

  // Re-clamp when the window or parent container shrinks/grows, preserving
  // the user's preferred width when room returns.
  useEffect(() => {
    const sync = () => setWidth(clamp(preferred.current))
    window.addEventListener('resize', sync)
    let observer: ResizeObserver | undefined
    if (container && typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(sync)
      observer.observe(container)
    }
    return () => {
      window.removeEventListener('resize', sync)
      observer?.disconnect()
    }
  }, [clamp, container])

  const change = useCallback(
    (w: number, save: boolean) => {
      const next = clamp(w)
      preferred.current = next
      setWidth(next)
      if (save) writeWidth(key, next)
    },
    [clamp, key],
  )

  const handle = (
    <ResizeHandle
      width={width}
      onChange={change}
      onReset={() => change(initial, true)}
    />
  )
  return { width, handle, containerRef }
}

function ResizeHandle({
  width,
  onChange,
  onReset,
}: {
  width: number
  onChange: (w: number, save: boolean) => void
  onReset: () => void
}) {
  const { t } = useTranslation()
  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return
    e.preventDefault()
    const el = e.currentTarget
    const startX = e.clientX
    const startWidth = width
    el.setPointerCapture(e.pointerId)
    document.body.style.cursor = 'col-resize'

    const move = (ev: PointerEvent) =>
      onChange(startWidth + ev.clientX - startX, false)
    const up = (ev: PointerEvent) => {
      onChange(startWidth + ev.clientX - startX, true)
      document.body.style.cursor = ''
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-valuenow={width}
      tabIndex={0}
      title={t('resizable.drag-to-resize-double-click-to-reset')}
      onPointerDown={onPointerDown}
      onDoubleClick={onReset}
      onKeyDown={(e) => {
        const step =
          e.key === 'ArrowLeft'
            ? -KEY_STEP
            : e.key === 'ArrowRight'
              ? KEY_STEP
              : 0
        if (!step) return
        e.preventDefault()
        onChange(width + step, true)
      }}
      className="absolute top-0 -right-[3px] z-1 h-full w-[5px] cursor-col-resize outline-none hover:bg-accent/50 focus-visible:bg-accent/50 active:bg-accent"
    />
  )
}
