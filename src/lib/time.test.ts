import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { relativeTime } from './time'

const NOW = 1_760_000_000

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW * 1000)
})
afterEach(() => vi.useRealTimers())

// The labels come from Intl in the user's locale, so compare against Intl
// rather than English strings.
const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })

it.each([
  [NOW - 10, rtf.format(0, 'second')],
  [NOW - 120, rtf.format(-2, 'minute')],
  [NOW - 3 * 3600, rtf.format(-3, 'hour')],
  [NOW - 86400, rtf.format(-1, 'day')],
  [NOW - 15 * 86400, rtf.format(-2, 'week')],
  [NOW - 400 * 86400, rtf.format(-1, 'year')],
  [NOW + 7200, rtf.format(2, 'hour')],
])('relativeTime(%i)', (time, label) => {
  expect(relativeTime(time)).toBe(label)
})
