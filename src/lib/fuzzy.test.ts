import { expect, it } from 'vitest'
import { fuzzyFilter, fuzzyScore } from './fuzzy'

it('needs every character in order', () => {
  expect(fuzzyScore('psh', 'Push')).not.toBeNull()
  expect(fuzzyScore('hsp', 'Push')).toBeNull()
  expect(fuzzyScore('', 'anything')).toBe(0)
})

it('ranks word starts and runs first', () => {
  const items = ['Open in browser', 'New branch…', 'Switch branch…']
  expect(fuzzyFilter('nb', items, (x) => x)[0]).toBe('New branch…')
  expect(fuzzyFilter('switch', items, (x) => x)).toEqual(['Switch branch…'])
})

it('keeps the original order without a query', () => {
  const items = ['b', 'a', 'c']
  expect(fuzzyFilter('  ', items, (x) => x)).toEqual(items)
})
