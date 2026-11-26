import { useSyncExternalStore } from 'react'
import type { Remote } from './git'
import { read, readFlag, write, writeFlag } from './prefs'

/** The remote that `upstream` ("origin/main") belongs to, else `origin`,
 *  else the first one. Remote names can contain slashes themselves. */
export function defaultRemote(remotes: Remote[], upstream?: string | null) {
  const owner = remotes
    .filter((r) => upstream?.startsWith(`${r.name}/`))
    .sort((a, b) => b.name.length - a.name.length)[0]
  return owner ?? remotes.find((r) => r.name === 'origin') ?? remotes[0] ?? null
}

/** Hides a password or token that is part of a URL. */
export function maskUrl(url: string) {
  return url.replace(/^(\w+:\/\/)[^@/]*:[^@/]*@/, '$1***@')
}

// Stored the other way round: flags are off until set, pruning is on.
const KEEP_DELETED = 'fetch.keepDeleted'

/** Whether fetching forgets branches that were deleted on the remote. */
export const readPrune = () => !readFlag(KEEP_DELETED)
export const writePrune = (on: boolean) => writeFlag(KEEP_DELETED, !on)

const FETCH_EVERY = 'gitgud.fetch.everyMinutes'

/** How often a repository is fetched in the background, in minutes. */
export const FETCH_INTERVALS = [0, 5, 15, 30, 60] as const

export function readFetchEvery() {
  const n = Number(read(FETCH_EVERY))
  return (FETCH_INTERVALS as readonly number[]).includes(n) ? n : 0
}

let fetchEvery = readFetchEvery()
const listeners = new Set<() => void>()

/** 0 turns background fetching off. */
export function setFetchEvery(minutes: number) {
  write(FETCH_EVERY, String(minutes))
  fetchEvery = minutes
  listeners.forEach((l) => l())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export const useFetchEvery = () =>
  useSyncExternalStore(subscribe, () => fetchEvery)
