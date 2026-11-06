import { describe, expect, it } from 'vitest'
import { addRecent, readRecents, removeRecent } from './prefs'

const repo = (n: number) => ({ path: `/code/r${n}`, name: `r${n}` })

it('keeps the 10 most recent repositories, newest first, without duplicates', () => {
  for (let i = 0; i < 12; i++) addRecent(repo(i))
  addRecent(repo(5))
  const paths = readRecents().map((r) => r.path)
  expect(paths).toHaveLength(10)
  expect(paths[0]).toBe('/code/r5')
  expect(paths.filter((p) => p === '/code/r5')).toHaveLength(1)
  expect(paths).not.toContain('/code/r0')

  removeRecent('/code/r5')
  expect(readRecents().map((r) => r.path)).not.toContain('/code/r5')
})

it('picks up the single repository remembered by older versions', () => {
  localStorage.setItem('gitgud.lastRepo', 'C:\\code\\old-one\\')
  expect(readRecents()).toEqual([
    { path: 'C:\\code\\old-one\\', name: 'old-one' },
  ])
})

it('starts over when the stored list is corrupt', () => {
  localStorage.setItem('gitgud.recentRepos', '{not json')
  expect(readRecents()).toEqual([])
  localStorage.setItem(
    'gitgud.recentRepos',
    '[{"path":1},{"path":"/a","name":"a"}]',
  )
  expect(readRecents()).toEqual([{ path: '/a', name: 'a' }])
})

describe('themes', () => {
  it('falls back to system for unknown names', async () => {
    const { readTheme, setTheme } = await import('./prefs')
    localStorage.setItem('gitgud.theme', 'neon-pink')
    expect(readTheme()).toBe('system')
    setTheme('nord')
    expect(readTheme()).toBe('nord')
    expect(document.documentElement.dataset.theme).toBe('nord')
  })

  it('resolves system to light or dark', async () => {
    const { applyTheme } = await import('./prefs')
    applyTheme('system')
    expect(['light', 'dark']).toContain(document.documentElement.dataset.theme)
  })

  it('has a CSS palette for every theme', async () => {
    const { THEMES } = await import('./prefs')
    const fs = await import('node:fs')
    const css = fs.readFileSync('src/index.css', 'utf8')
    for (const t of THEMES.filter((t) => t.id !== 'light'))
      expect(css).toContain(`:root[data-theme='${t.id}']`)
  })
})

describe('panel widths', () => {
  it('remembers widths and flags', async () => {
    const { readWidth, writeWidth, readFlag, writeFlag } =
      await import('./prefs')
    expect(readWidth('x', 300)).toBe(300)
    writeWidth('x', 412.6)
    expect(readWidth('x', 300)).toBe(413)
    expect(readFlag('f')).toBe(false)
    writeFlag('f', true)
    expect(readFlag('f')).toBe(true)
  })
})
