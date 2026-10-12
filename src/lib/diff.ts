export type LineKind = 'add' | 'remove' | 'context' | 'hunk' | 'meta'

export interface Line {
  kind: LineKind
  text: string
  /** Position in diff.split('\n'); the backend identifies lines by it. */
  index: number
  /** Which hunk the line belongs to, -1 before the first one. */
  hunk: number
  oldNo?: number
  newNo?: number
}

const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/

/** Turns unified diff text into lines with old/new line numbers. */
export function parseDiff(diff: string): Line[] {
  const lines: Line[] = []
  let oldNo = 0
  let newNo = 0
  let hunk = -1
  let inHunk = false

  diff.split('\n').forEach((text, index) => {
    const base = { index, hunk }
    const match = HUNK.exec(text)
    if (match) {
      oldNo = Number(match[1])
      newNo = Number(match[2])
      inHunk = true
      hunk += 1
      lines.push({ kind: 'hunk', text, index, hunk })
    } else if (text.startsWith('diff --git')) {
      inHunk = false
      lines.push({ ...base, kind: 'meta', text })
    } else if (!inHunk) {
      lines.push({ ...base, kind: 'meta', text })
    } else if (text.startsWith('+')) {
      lines.push({ ...base, kind: 'add', text: text.slice(1), newNo: newNo++ })
    } else if (text.startsWith('-')) {
      lines.push({
        ...base,
        kind: 'remove',
        text: text.slice(1),
        oldNo: oldNo++,
      })
    } else if (text.startsWith('\\')) {
      lines.push({ ...base, kind: 'meta', text })
    } else {
      lines.push({
        ...base,
        kind: 'context',
        text: text.slice(1),
        oldNo: oldNo++,
        newNo: newNo++,
      })
    }
  })

  while (lines.length && lines[lines.length - 1].text === '') lines.pop()
  return lines
}
