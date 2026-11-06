import { useCallback, useEffect, useState } from 'react'
import { readWidth, writeWidth } from '../lib/prefs'

/** Room always left for the diff next to a resized panel. */
const KEEP_FOR_REST = 360
const KEY_STEP = 16

interface Options {
  /** Remembers the width under this name. */
  key: string
  initial: number
  min: number
  max: number
}

/**
 * A panel width the user can drag. Returns the width to apply and a handle
 * to render inside the panel, which must be `relative`. Double-clicking the
 * handle goes back to the initial width.
 */
export function useResizable({ key, initial, min, max }: Options) {
  const clamp = useCallback(
    (w: number) =>
      Math.round(
        Math.max(min, Math.min(w, max, window.innerWidth - KEEP_FOR_REST)),
      ),
    [min, max],
  )
  const [width, setWidth] = useState(() => clamp(readWidth(key, initial)))

  // Different panels (e.g. the Changes and History sidebars) share a spot
  // but keep their own widths.
  useEffect(
    () => setWidth(clamp(readWidth(key, initial))),
    [key, initial, clamp],
  )

  const change = useCallback(
    (w: number, save: boolean) => {
      const next = clamp(w)
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
  return { width, handle }
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
      title="Drag to resize, double-click to reset"
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
      className="absolute top-0 -right-[3px] z-20 h-full w-[5px] cursor-col-resize outline-none hover:bg-accent/50 focus-visible:bg-accent/50 active:bg-accent"
    />
  )
}
