import { expect, it } from 'vitest'
import {
  getAppearance,
  previewTheme,
  readAppearance,
  setAppearance,
} from './appearance'

const root = document.documentElement

it('replaces missing and invalid settings with defaults', () => {
  localStorage.setItem('gitgud.theme', 'neon-pink')
  localStorage.setItem(
    'gitgud.appearance',
    // A dark theme can't be the light one.
    '{"lightTheme":"dracula","accent":"toString","codeSize":900,"codeFont":4}',
  )
  expect(readAppearance()).toEqual({
    theme: 'system',
    lightTheme: 'light',
    darkTheme: 'dark',
    accent: null,
    diffColors: 'default',
    codeSize: 12,
    codeFont: '',
  })
  localStorage.setItem('gitgud.appearance', '{not json')
  expect(readAppearance().codeSize).toBe(12)
})

it('keeps the theme chosen in older versions', () => {
  localStorage.setItem('gitgud.theme', 'nord')
  expect(readAppearance().theme).toBe('nord')
})

it('stores and applies a change', () => {
  setAppearance({ theme: 'nord', accent: 'teal', codeSize: 16 })
  expect(readAppearance()).toEqual(getAppearance())
  expect(root.dataset.theme).toBe('nord')
  expect(root.hasAttribute('data-dark')).toBe(true)
  expect(root.style.getPropertyValue('--app-accent')).toBe('#5fd9cb')
  expect(root.style.getPropertyValue('--code-row')).toBe('24px')
  setAppearance({ accent: null })
  expect(root.style.getPropertyValue('--app-accent')).toBe('')
})

it('cannot break out of the font name', () => {
  setAppearance({ codeFont: 'Fira "Code; }' })
  expect(root.style.getPropertyValue('--code-font')).toBe(
    '"Fira Code", var(--font-mono)',
  )
})

it('follows the system with the picked theme', () => {
  // matchMedia says light in tests.
  setAppearance({ theme: 'system', lightTheme: 'gruvbox-light' })
  expect(root.dataset.theme).toBe('gruvbox-light')
})

it('previews a theme without keeping it', () => {
  setAppearance({ theme: 'nord' })
  const undo = previewTheme('dracula')
  expect(root.dataset.theme).toBe('dracula')
  expect(readAppearance().theme).toBe('nord')
  undo()
  expect(root.dataset.theme).toBe('nord')
})
