// Per-machine conveniences kept in localStorage. Storage can be missing or
// throw (e.g. blocked site data), so every access falls back quietly.

import type { RepoInfo } from './git'

const RECENTS_KEY = 'gitgud.recentRepos'
// Only the last repository was remembered before recents existed.
const LEGACY_LAST_REPO_KEY = 'gitgud.lastRepo'
const MAX_RECENTS = 10

export function read(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

export function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Nothing breaks without it.
  }
}

const baseName = (path: string) =>
  path
    .replace(/[\\/]+$/, '')
    .split(/[\\/]/)
    .pop() || path

/** Recently opened repositories, most recent first. */
export function readRecents(): RepoInfo[] {
  try {
    const list = JSON.parse(read(RECENTS_KEY) ?? 'null')
    if (Array.isArray(list))
      return list.filter(
        (r): r is RepoInfo =>
          typeof r?.path === 'string' && typeof r?.name === 'string',
      )
  } catch {
    // Corrupt value: start over.
  }
  const last = read(LEGACY_LAST_REPO_KEY)
  return last ? [{ path: last, name: baseName(last) }] : []
}

function writeRecents(list: RepoInfo[]) {
  write(RECENTS_KEY, JSON.stringify(list))
  return list
}

export const addRecent = (repo: RepoInfo) =>
  writeRecents(
    [repo, ...readRecents().filter((r) => r.path !== repo.path)].slice(
      0,
      MAX_RECENTS,
    ),
  )

export const removeRecent = (path: string) =>
  writeRecents(readRecents().filter((r) => r.path !== path))

/** A panel width the user dragged to, in pixels. */
export function readWidth(key: string, fallback: number) {
  const n = Number(read(`gitgud.width.${key}`))
  return Number.isFinite(n) && n > 0 ? n : fallback
}

export function writeWidth(key: string, width: number) {
  write(`gitgud.width.${key}`, String(Math.round(width)))
}

export function readFlag(key: string) {
  return read(`gitgud.${key}`) === '1'
}

export function writeFlag(key: string, on: boolean) {
  write(`gitgud.${key}`, on ? '1' : '0')
}

/** Commits whose branch lines are hidden in a repository's history graph;
 *  see src/lib/lines.ts. */
export function readHiddenLines(repo: string): string[] {
  try {
    const list = JSON.parse(read(`gitgud.hiddenLines:${repo}`) ?? '[]')
    return Array.isArray(list) ? list.filter((h) => typeof h === 'string') : []
  } catch {
    return []
  }
}

export function writeHiddenLines(repo: string, hashes: string[]) {
  write(`gitgud.hiddenLines:${repo}`, JSON.stringify(hashes))
}
