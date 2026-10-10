// Per-machine conveniences kept in localStorage. Storage can be missing or
// throw (e.g. blocked site data), so every access falls back quietly.

import { getCurrentWindow } from '@tauri-apps/api/window'
import type { RepoInfo } from './git'

const RECENTS_KEY = 'gitgud.recentRepos'
// Only the last repository was remembered before recents existed.
const LEGACY_LAST_REPO_KEY = 'gitgud.lastRepo'
const THEME_KEY = 'gitgud.theme'
const MAX_RECENTS = 10

function read(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function write(key: string, value: string) {
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

export type Theme = 'system' | 'light' | 'dark'

export function readTheme(): Theme {
  const t = read(THEME_KEY)
  return t === 'light' || t === 'dark' ? t : 'system'
}

const systemDark = window.matchMedia('(prefers-color-scheme: dark)')

function resolve(theme: Theme) {
  return theme === 'system' ? (systemDark.matches ? 'dark' : 'light') : theme
}

/** Sets the colors on <html> and the native title bar. */
export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = resolve(theme)
  // Not available outside Tauri (e.g. in a plain browser during development).
  try {
    getCurrentWindow()
      .setTheme(theme === 'system' ? null : theme)
      .catch(() => {})
  } catch {
    // Same as above.
  }
}

export function setTheme(theme: Theme) {
  write(THEME_KEY, theme)
  applyTheme(theme)
}

systemDark.addEventListener('change', () => {
  if (readTheme() === 'system') applyTheme('system')
})
