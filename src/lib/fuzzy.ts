/**
 * Scores how well `query` matches `text`: every query character must appear
 * in order, case-insensitively. Returns null for no match; higher is better.
 * Consecutive characters, word starts and an early first match score more,
 * so "nb" ranks "New branch" above "Open in browser".
 */
export function fuzzyScore(query: string, text: string): number | null {
  const q = query.toLowerCase().replace(/\s+/g, '')
  if (!q) return 0
  const t = text.toLowerCase()
  let score = 0
  let from = 0
  let previous = -2
  for (const c of q) {
    const i = t.indexOf(c, from)
    if (i === -1) return null
    const wordStart = i === 0 || /[\s/._-]/.test(t[i - 1])
    score += 1
    if (i === previous + 1) score += 3
    if (wordStart) score += 4
    previous = i
    from = i + 1
  }
  // Prefer matches that start early and texts that are short.
  const first = t.indexOf(q[0])
  return score - first * 0.1 - t.length * 0.01
}

/** The items that match, best first; all of them in order for no query. */
export function fuzzyFilter<T>(
  query: string,
  items: T[],
  text: (item: T) => string,
): T[] {
  if (!query.trim()) return items
  return items
    .map((item, i) => ({ item, i, score: fuzzyScore(query, text(item)) }))
    .filter((x) => x.score !== null)
    .sort((a, b) => b.score! - a.score! || a.i - b.i)
    .map((x) => x.item)
}
