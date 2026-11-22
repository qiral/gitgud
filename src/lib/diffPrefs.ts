import { useSyncExternalStore } from 'react'
import { readFlag, writeFlag } from './prefs'

/** How diffs are shown, the same in every diff view and remembered. */
export interface DiffPrefs {
  /** Side by side instead of unified. */
  split: boolean
  /** Hide changes that only touch whitespace (`git diff -w`). */
  ignoreWhitespace: boolean
}

const KEYS: Record<keyof DiffPrefs, string> = {
  split: 'diff.split',
  ignoreWhitespace: 'diff.ignoreWhitespace',
}

let current: DiffPrefs = {
  split: readFlag(KEYS.split),
  ignoreWhitespace: readFlag(KEYS.ignoreWhitespace),
}
const listeners = new Set<() => void>()

export function setDiffPref(key: keyof DiffPrefs, on: boolean) {
  writeFlag(KEYS[key], on)
  current = { ...current, [key]: on }
  listeners.forEach((l) => l())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export const useDiffPrefs = () => useSyncExternalStore(subscribe, () => current)
