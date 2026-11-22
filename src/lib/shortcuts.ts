/** Keyboard shortcuts written like "mod+shift+p": `mod` is Cmd on macOS and
 *  Ctrl elsewhere, the last part is the key. */
export type Shortcut = string

export const isMac =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)

/** The key a shortcut names. Letters follow the keyboard layout (Ctrl+Z
 *  is the key labeled Z), falling back to the key's position on layouts
 *  without Latin letters. Digits are matched by position, so Shift+1 is
 *  still "1" whatever symbol the layout puts there. */
function keyOf(e: KeyboardEvent) {
  if (/^[a-z]$/i.test(e.key)) return e.key.toLowerCase()
  if (/^Key[A-Z]$/.test(e.code)) return e.code.slice(3).toLowerCase()
  if (/^Digit\d$/.test(e.code)) return e.code.slice(5)
  return e.key.toLowerCase()
}

export function matches(e: KeyboardEvent, shortcut: Shortcut) {
  const parts = shortcut.toLowerCase().split('+')
  const key = parts.pop()
  const mod = parts.includes('mod')
  const want = {
    ctrl: parts.includes('ctrl') || (mod && !isMac),
    meta: mod && isMac,
    shift: parts.includes('shift'),
    alt: parts.includes('alt'),
  }
  return (
    e.ctrlKey === want.ctrl &&
    e.metaKey === want.meta &&
    e.shiftKey === want.shift &&
    e.altKey === want.alt &&
    keyOf(e) === key
  )
}

const MAC_SYMBOLS: Record<string, string> = {
  mod: '⌘',
  ctrl: '⌃',
  shift: '⇧',
  alt: '⌥',
}

/** The keys to press, e.g. ["Ctrl", "Shift", "P"] or ["⌘", "⇧", "P"]. */
export function shortcutKeys(shortcut: Shortcut): string[] {
  return shortcut.split('+').map((part) => {
    const p = part.toLowerCase()
    if (isMac && MAC_SYMBOLS[p]) return MAC_SYMBOLS[p]
    if (p === 'mod') return 'Ctrl'
    if (p.length === 1) return p.toUpperCase()
    return p[0].toUpperCase() + p.slice(1)
  })
}

/** Whether a key press is typing into a field rather than a command. */
export function isTyping(e: KeyboardEvent) {
  const t = e.target
  return (
    t instanceof HTMLElement &&
    (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))
  )
}
