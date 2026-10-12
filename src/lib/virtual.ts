import { useLayoutEffect, useRef, useState } from 'react'

/** Extra rows rendered above and below the visible ones, so fast scrolling
 *  doesn't show blank space before React catches up. */
const OVERSCAN = 20

/** The element itself if it scrolls, otherwise its nearest scrolling ancestor. */
function scrollParent(el: HTMLElement): HTMLElement {
  for (let node: HTMLElement | null = el; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node)
    if (overflowY === 'auto' || overflowY === 'scroll') return node
  }
  return document.documentElement
}

/**
 * Which rows of a list with fixed-height rows are on screen. Attach `ref` to
 * the list element; render rows `start` to `end` (exclusive) with `top` and
 * `bottom` pixels of spacing around them. With `enabled` false every row is
 * rendered.
 */
export function useVirtualRows<T extends HTMLElement>(
  count: number,
  rowHeight: number,
  enabled = true,
) {
  const ref = useRef<T>(null)
  const [range, setRange] = useState({ start: 0, end: 0 })

  useLayoutEffect(() => {
    const el = ref.current
    if (!el || !enabled) return
    const scroller = scrollParent(el)

    const update = () => {
      // Where the list starts inside the scrolled content; it may sit below
      // other content, such as a toolbar above a diff.
      const offset =
        el === scroller
          ? 0
          : el.getBoundingClientRect().top -
            scroller.getBoundingClientRect().top +
            scroller.scrollTop
      const from = scroller.scrollTop - offset
      const start = Math.max(0, Math.floor(from / rowHeight) - OVERSCAN)
      const end = Math.min(
        count,
        Math.ceil((from + scroller.clientHeight) / rowHeight) + OVERSCAN,
      )
      setRange((r) => (r.start === start && r.end === end ? r : { start, end }))
    }

    update()
    scroller.addEventListener('scroll', update, { passive: true })
    const resize = new ResizeObserver(update)
    resize.observe(scroller)
    return () => {
      scroller.removeEventListener('scroll', update)
      resize.disconnect()
    }
  }, [count, rowHeight, enabled])

  if (!enabled) return { ref, start: 0, end: count, top: 0, bottom: 0 }
  const end = Math.min(range.end, count)
  const start = Math.min(range.start, end)
  return {
    ref,
    start,
    end,
    top: start * rowHeight,
    bottom: (count - end) * rowHeight,
  }
}
