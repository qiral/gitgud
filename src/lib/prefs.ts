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

export interface ThemeInfo {
  id: string
  label: string
  dark: boolean
  /** Background, sidebar and accent colors, for the preview in the menu.
   *  The full palettes live in src/index.css. */
  swatch: [string, string, string]
}

export const THEMES: ThemeInfo[] = [
  {
    id: 'light',
    label: 'Light',
    dark: false,
    swatch: ['#ffffff', '#f6f7f9', '#4f6ef7'],
  },
  {
    id: 'dark',
    label: 'Dark',
    dark: true,
    swatch: ['#16181d', '#1d2026', '#7b93ff'],
  },
  {
    id: 'solarized-light',
    label: 'Solarized Light',
    dark: false,
    swatch: ['#fdf6e3', '#eee8d5', '#268bd2'],
  },
  {
    id: 'solarized-dark',
    label: 'Solarized Dark',
    dark: true,
    swatch: ['#002b36', '#073642', '#3a96dd'],
  },
  {
    id: 'catppuccin-latte',
    label: 'Catppuccin Latte',
    dark: false,
    swatch: ['#eff1f5', '#e6e9ef', '#1e66f5'],
  },
  {
    id: 'catppuccin-mocha',
    label: 'Catppuccin Mocha',
    dark: true,
    swatch: ['#1e1e2e', '#181825', '#89b4fa'],
  },
  {
    id: 'nord',
    label: 'Nord',
    dark: true,
    swatch: ['#2e3440', '#3b4252', '#88c0d0'],
  },
  {
    id: 'dracula',
    label: 'Dracula',
    dark: true,
    swatch: ['#282a36', '#21222c', '#bd93f9'],
  },
  {
    id: 'gruvbox',
    label: 'Gruvbox Dark',
    dark: true,
    swatch: ['#282828', '#1d2021', '#83a598'],
  },
]

/** 'system' follows the OS between Light and Dark; anything else is a
 *  THEMES id. */
export type Theme = string

export function readTheme(): Theme {
  const t = read(THEME_KEY)
  return t && THEMES.some((x) => x.id === t) ? t : 'system'
}

const systemDark = window.matchMedia('(prefers-color-scheme: dark)')

function resolve(theme: Theme): ThemeInfo {
  const id =
    theme === 'system' ? (systemDark.matches ? 'dark' : 'light') : theme
  return THEMES.find((t) => t.id === id) ?? THEMES[0]
}

/** Sets the colors on <html> and the native title bar. */
export function applyTheme(theme: Theme) {
  const info = resolve(theme)
  document.documentElement.dataset.theme = info.id
  // Not available outside Tauri (e.g. in a plain browser during development).
  try {
    getCurrentWindow()
      .setTheme(theme === 'system' ? null : info.dark ? 'dark' : 'light')
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
