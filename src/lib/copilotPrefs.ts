import { useSyncExternalStore } from 'react'
import { readFlag, writeFlag } from './prefs'

/** Every Copilot action, each of which can be turned off on its own. */
export const COPILOT_ACTIONS = [
  'commitMessage',
  'stashMessage',
  'review',
  'explain',
  'conflicts',
  'branchName',
  'releaseNotes',
  'squashMessage',
  'pullRequest',
] as const

export type CopilotAction = (typeof COPILOT_ACTIONS)[number]

/** Which Copilot actions are on. Stored as the ones turned off, so new
 *  actions start on. */
export type CopilotPrefs = Record<CopilotAction, boolean>

const key = (action: CopilotAction) => `copilot.off.${action}`

let current = Object.fromEntries(
  COPILOT_ACTIONS.map((a) => [a, !readFlag(key(a))]),
) as CopilotPrefs
const listeners = new Set<() => void>()

export function setCopilotAction(action: CopilotAction, on: boolean) {
  writeFlag(key(action), !on)
  current = { ...current, [action]: on }
  listeners.forEach((l) => l())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export const useCopilotPrefs = () =>
  useSyncExternalStore(subscribe, () => current)
