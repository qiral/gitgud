import { expect, it } from 'vitest'
// @ts-expect-error type error without @types/node package
import { readFileSync } from 'node:fs'
import { THEMES } from './themes'

// Vitest leaves CSS imports empty, so the file is read from disk.
const css: string = readFileSync('src/themes.css', 'utf8')

function luminance(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(a: string, b: string) {
  const [dark, light] = [luminance(a), luminance(b)].sort((x, y) => x - y)
  return (light + 0.05) / (dark + 0.05)
}

function colors(id: string) {
  const block = css.split(`[data-theme='${id}'] {`)[1]?.split('}')[0] ?? ''
  return Object.fromEntries(
    [...block.matchAll(/--app-([\w-]+): (#[0-9a-f]{6});/g)].map((m) => [
      m[1],
      m[2],
    ]),
  )
}

it('has no duplicate themes', () => {
  expect(new Set(THEMES.map((t) => t.id)).size).toBe(THEMES.length)
})

it.each(THEMES)('$label has every color, readable', ({ id }) => {
  const c = colors(id)
  expect(Object.keys(c)).toHaveLength(19)
  for (const bg of [c.bg, c.panel]) {
    expect(contrast(c.fg, bg)).toBeGreaterThan(5.5)
    expect(contrast(c.muted, bg)).toBeGreaterThan(3)
  }
  expect(contrast(c.fg, c['added-bg'])).toBeGreaterThan(4.5)
  expect(contrast(c.fg, c['removed-bg'])).toBeGreaterThan(4.5)
  for (const [name, color] of Object.entries(c).filter(([k]) =>
    k.startsWith('syn-'),
  ))
    for (const bg of [c.bg, c['added-bg'], c['removed-bg']])
      expect(contrast(color, bg), name).toBeGreaterThan(3.5)
  expect(contrast(c.accent, c.bg)).toBeGreaterThan(3)
  expect(contrast(c['on-accent'], c.accent)).toBeGreaterThan(2.8)
})
