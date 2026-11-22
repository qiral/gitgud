import { expect, it } from 'vitest'
import { isMac, matches, shortcutKeys } from './shortcuts'

const press = (init: KeyboardEventInit) => new KeyboardEvent('keydown', init)
const mod = isMac ? { metaKey: true } : { ctrlKey: true }

it('matches modifiers exactly', () => {
  expect(matches(press({ ...mod, key: 'p', code: 'KeyP' }), 'mod+p')).toBe(true)
  expect(
    matches(press({ ...mod, shiftKey: true, key: 'P', code: 'KeyP' }), 'mod+p'),
  ).toBe(false)
  expect(
    matches(
      press({ ...mod, shiftKey: true, key: 'P', code: 'KeyP' }),
      'mod+shift+p',
    ),
  ).toBe(true)
  expect(matches(press({ key: 'p', code: 'KeyP' }), 'mod+p')).toBe(false)
})

it('follows the layout for letters and the position for digits', () => {
  // AZERTY: the key labeled A sits where Q is on QWERTY.
  expect(matches(press({ ...mod, key: 'a', code: 'KeyQ' }), 'mod+a')).toBe(true)
  // Cyrillic letters fall back to the key's position.
  expect(matches(press({ ...mod, key: 'к', code: 'KeyR' }), 'mod+r')).toBe(true)
  // AZERTY again: the 1 key types "&" without Shift.
  expect(matches(press({ ...mod, key: '&', code: 'Digit1' }), 'mod+1')).toBe(
    true,
  )
  expect(matches(press({ key: 'F1', code: 'F1' }), 'f1')).toBe(true)
})

it('spells out the keys', () => {
  expect(shortcutKeys('mod+shift+p')).toEqual(
    isMac ? ['⌘', '⇧', 'P'] : ['Ctrl', 'Shift', 'P'],
  )
  expect(shortcutKeys('f1')).toEqual(['F1'])
})
