import { getLocale } from '../i18n'

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 31536000],
  ['month', 2592000],
  ['week', 604800],
  ['day', 86400],
  ['hour', 3600],
  ['minute', 60],
]

const rtfCache = new Map<string, Intl.RelativeTimeFormat>()

function rtf(locale: string) {
  let cached = rtfCache.get(locale)
  if (!cached) {
    cached = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
    rtfCache.set(locale, cached)
  }
  return cached
}

/** "3 days ago" style label for a Unix timestamp in seconds, in the active language. */
export function relativeTime(
  unixSeconds: number,
  locale: string = getLocale(),
) {
  const diff = unixSeconds - Date.now() / 1000
  for (const [unit, seconds] of UNITS) {
    if (Math.abs(diff) >= seconds)
      return rtf(locale).format(Math.round(diff / seconds), unit)
  }
  return rtf(locale).format(0, 'second')
}
