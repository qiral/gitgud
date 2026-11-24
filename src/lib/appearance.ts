// How the app looks: theme, accent, diff colors and code text. Kept in
// localStorage and applied to <html>, where src/themes.css picks it up.

import { useSyncExternalStore } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { read, write } from './prefs'
import { THEMES, type ThemeInfo } from './themes'

const THEME_KEY = 'gitgud.theme'
const APPEARANCE_KEY = 'gitgud.appearance'

/** Accent colors to use instead of the theme's own: one that reads well on
 *  light backgrounds, one for dark. */
export const ACCENTS = {
  blue: ['#2563eb', '#7aa8ff'],
  violet: ['#7c3aed', '#b39dfa'],
  pink: ['#be1e6d', '#f78fc0'],
  red: ['#c62828', '#ff8a80'],
  orange: ['#b34700', '#ffab70'],
  green: ['#1b7a3d', '#7ddc96'],
  teal: ['#0f766e', '#5fd9cb'],
  gray: ['#4b5563', '#b6bdc9'],
} satisfies Record<string, [light: string, dark: string]>

export type Accent = keyof typeof ACCENTS

export const MIN_CODE_SIZE = 10
export const MAX_CODE_SIZE = 18
const DEFAULT_CODE_SIZE = 12

export interface Appearance {
  /** 'system' follows the OS between lightTheme and darkTheme; anything else
   *  is a THEMES id. */
  theme: string
  lightTheme: string
  darkTheme: string
  /** null uses the theme's accent. */
  accent: Accent | null
  diffColors: 'default' | 'blue-orange'
  codeSize: number
  /** A font installed on this machine; empty uses the default. */
  codeFont: string
  /** Syntax highlighting in diffs and blame. */
  syntax: boolean
}

const isTheme = (id: unknown, dark?: boolean): id is string =>
  THEMES.some((t) => t.id === id && (dark === undefined || t.dark === dark))

/** The stored settings, with anything missing or invalid at its default. */
export function readAppearance(): Appearance {
  let raw: Record<string, unknown> = {}
  try {
    const parsed = JSON.parse(read(APPEARANCE_KEY) ?? '{}')
    if (parsed && typeof parsed === 'object') raw = parsed
  } catch {
    // Corrupt value: start over.
  }
  const theme = read(THEME_KEY)
  const size = Math.round(Number(raw.codeSize ?? DEFAULT_CODE_SIZE))
  return {
    theme: isTheme(theme) ? theme : 'system',
    lightTheme: isTheme(raw.lightTheme, false) ? raw.lightTheme : 'light',
    darkTheme: isTheme(raw.darkTheme, true) ? raw.darkTheme : 'dark',
    accent:
      typeof raw.accent === 'string' &&
      Object.keys(ACCENTS).includes(raw.accent)
        ? (raw.accent as Accent)
        : null,
    diffColors: raw.diffColors === 'blue-orange' ? 'blue-orange' : 'default',
    codeSize:
      size >= MIN_CODE_SIZE && size <= MAX_CODE_SIZE ? size : DEFAULT_CODE_SIZE,
    codeFont: typeof raw.codeFont === 'string' ? raw.codeFont : '',
    syntax: raw.syntax !== false,
  }
}

/** Height of a line of code in pixels, set as --code-row. Never less than
 *  the buttons in a hunk header need. */
export const codeRow = (size: number) => Math.max(20, size + 8)

/** A font name as a CSS string, followed by the default font. */
const fontFamily = (name: string) => {
  const clean = name.replace(/["'\;{}\n]/g, '').trim()
  return clean ? `"${clean}", var(--font-mono)` : ''
}

const systemDark = window.matchMedia('(prefers-color-scheme: dark)')

export function resolveTheme(a: Appearance): ThemeInfo {
  const id =
    a.theme === 'system'
      ? systemDark.matches
        ? a.darkTheme
        : a.lightTheme
      : a.theme
  return THEMES.find((t) => t.id === id) ?? THEMES[0]
}

function paint(a: Appearance) {
  const info = resolveTheme(a)
  const root = document.documentElement
  const set = (name: string, value: string | null) =>
    value
      ? root.style.setProperty(name, value)
      : root.style.removeProperty(name)

  root.dataset.theme = info.id
  root.toggleAttribute('data-dark', info.dark)
  root.dataset.diffColors = a.diffColors
  set('--app-accent', a.accent && ACCENTS[a.accent][info.dark ? 1 : 0])
  set('--app-on-accent', a.accent && (info.dark ? '#16181d' : '#ffffff'))
  set('--code-size', `${a.codeSize}px`)
  set('--code-row', `${codeRow(a.codeSize)}px`)
  set('--code-font', fontFamily(a.codeFont))
  return info
}

let current = readAppearance()
const listeners = new Set<() => void>()

/** Sets the colors on <html> and the native title bar. */
export function applyAppearance() {
  const info = paint(current)
  // Not available outside Tauri (e.g. in a plain browser during development).
  try {
    getCurrentWindow()
      .setTheme(
        current.theme === 'system' ? null : info.dark ? 'dark' : 'light',
      )
      .catch(() => {})
  } catch {
    // Same as above.
  }
}

export function setAppearance(change: Partial<Appearance>) {
  current = { ...current, ...change }
  const { theme, ...rest } = current
  write(THEME_KEY, theme)
  write(APPEARANCE_KEY, JSON.stringify(rest))
  applyAppearance()
  listeners.forEach((l) => l())
}

/** Shows a theme without keeping it; the function returned goes back to the
 *  one that is set. */
export function previewTheme(theme: string) {
  paint({ ...current, theme })
  return () => {
    paint(current)
  }
}

systemDark.addEventListener('change', () => {
  if (current.theme !== 'system') return
  applyAppearance()
  listeners.forEach((l) => l())
})

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export const getAppearance = () => current
export const useAppearance = () =>
  useSyncExternalStore(subscribe, getAppearance)
