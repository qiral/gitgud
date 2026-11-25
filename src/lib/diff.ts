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
  /** On a hunk header: the hidden lines around it, see expandDiff. */
  gap?: { id: number; canUp: boolean; canDown: boolean }
}

const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/
/** The same with the line counts. */
const HUNK_SIZES = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/

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

/** How many hidden lines to show of the gap before each hunk (the last gap
 *  comes after all hunks): `down` from its top, `up` from its bottom. */
export type Expanded = Record<number, { down: number; up: number }>

/** The new side's lines a diff's hunks claim, to compare with the file. */
function matchesFile(lines: Line[], file: string[]) {
  return lines.every(
    (l) =>
      l.newNo === undefined ||
      file[l.newNo - 1]?.replace(/\r$/, '') === l.text.replace(/\r$/, ''),
  )
}

/**
 * Adds unchanged lines from the file between a diff's hunks, as many as
 * `expanded` asks for. `file` is the new side's text, null until it's loaded.
 * Hunk headers, and one more after the last hunk, say what is still hidden.
 * Files that were added or deleted have nothing hidden and come back as is,
 * and so does a diff that isn't of that file anymore.
 */
export function expandDiff(
  lines: Line[],
  file: string | null,
  expanded: Expanded,
): Line[] {
  const hunks = lines.filter((l) => l.kind === 'hunk')
  const sizes = hunks.map((h) => HUNK_SIZES.exec(h.text))
  if (hunks.length === 0 || sizes.some((m) => !m)) return lines
  const ranges = sizes.map((m) => {
    const [oldStart, oldCount, newStart, newCount] = m!
      .slice(1)
      .map((n) => (n === undefined ? 1 : Number(n)))
    // An empty side names the line before it.
    return {
      oldStart: oldCount === 0 ? oldStart + 1 : oldStart,
      newStart: newCount === 0 ? newStart + 1 : newStart,
      oldCount,
      newCount,
    }
  })
  if (
    lines.some((l) =>
      l.kind === 'meta'
        ? /^(new|deleted) file mode/.test(l.text)
        : // A submodule's commit isn't a file.
          l.kind !== 'hunk' && l.text.startsWith('Subproject commit '),
    )
  )
    return lines

  let text: string[] | null = null
  if (file !== null) {
    text = file.split('\n')
    if (text[text.length - 1] === '') text.pop()
    if (!matchesFile(lines, text)) return lines
  }

  const out: Line[] = []
  /** Lines `from` up to `to` of the new side, none of them in the diff. */
  const show = (from: number, to: number, offset: number, hunk: number) => {
    for (let n = from; n < to; n++)
      out.push({
        kind: 'context',
        text: text![n - 1],
        // Not part of the diff's text, so no index there.
        index: -n,
        hunk,
        oldNo: n + offset,
        newNo: n,
      })
  }
  const gap = (
    id: number,
    from: number,
    to: number | null,
    offset: number,
    header: Line,
  ) => {
    const size = to === null ? null : Math.max(0, to - from)
    // Until the file is there, nobody knows how much comes after the end.
    const want = text ? (expanded[id] ?? { down: 0, up: 0 }) : null
    const down = Math.min(want?.down ?? 0, size ?? 0)
    const up = Math.min(want?.up ?? 0, (size ?? 0) - down)
    const left = size === null ? 1 : size - down - up
    const last = id === hunks.length
    show(from, from + down, offset, header.hunk - (last ? 0 : 1))
    if (left > 0 || !last)
      out.push({
        ...header,
        gap: { id, canDown: left > 0 && id > 0, canUp: left > 0 && !last },
      })
    if (to !== null) show(to - up, to, offset, header.hunk)
  }

  let next = 1
  let offset = 0
  let hunk = -1
  for (const l of lines) {
    if (l.kind === 'hunk') {
      const r = ranges[++hunk]
      offset = r.oldStart - r.newStart
      gap(hunk, next, r.newStart, offset, l)
      next = r.newStart + r.newCount
      offset += r.oldCount - r.newCount
    } else out.push(l)
  }
  gap(hunks.length, next, text ? text.length + 1 : null, offset, {
    kind: 'hunk',
    text: '',
    index: -1e9,
    hunk: hunks.length - 1,
  })
  return out
}

export type FileStatus = 'added' | 'deleted' | 'modified' | 'renamed' | 'copied'

/** One file's part of a multi-file patch, as `git show` prints it. */
export interface FileDiff {
  path: string
  /** Where a renamed or copied file came from. */
  oldPath?: string
  status: FileStatus
  additions: number
  deletions: number
  binary: boolean
  /** This file's patch, starting at its `diff --git` line. */
  diff: string
}

const ESCAPES: Record<string, number> = {
  a: 7,
  b: 8,
  t: 9,
  n: 10,
  v: 11,
  f: 12,
  r: 13,
  '"': 34,
  '\\': 92,
}

/** Undoes git's C-style quoting of paths with unusual characters, e.g.
 *  `"t\303\244st.txt"` for täst.txt. Unquoted paths come back as they are. */
export function unquotePath(raw: string): string {
  if (!raw.startsWith('"') || !raw.endsWith('"') || raw.length < 2) return raw
  const bytes: number[] = []
  const body = raw.slice(1, -1)
  for (let i = 0; i < body.length; i++) {
    const c = body[i]
    if (c !== '\\') {
      bytes.push(...new TextEncoder().encode(c))
      continue
    }
    const next = body[i + 1]
    const octal = /^[0-7]{3}/.exec(body.slice(i + 1))
    if (octal) {
      bytes.push(parseInt(octal[0], 8))
      i += 3
    } else if (next in ESCAPES) {
      bytes.push(ESCAPES[next])
      i += 1
    } else {
      bytes.push(92)
    }
  }
  return new TextDecoder().decode(new Uint8Array(bytes))
}

/** Drops the `a/` or `b/` prefix git puts on paths in patch headers. */
function stripPrefix(path: string) {
  // `---`/`+++` lines end in a tab when the path has spaces.
  const unquoted = unquotePath(path.replace(/\t$/, ''))
  return /^[ab]\//.test(unquoted) ? unquoted.slice(2) : unquoted
}

/** The path from a `diff --git a/x b/x` line. Only reliable when both sides
 *  are the same, which is the case whenever no other header names the file. */
function pathFromDiffLine(line: string) {
  const rest = line.slice('diff --git '.length)
  if (rest.startsWith('"')) {
    const end = rest.indexOf('" ', 1)
    if (end !== -1) return stripPrefix(rest.slice(end + 2))
  }
  const half = (rest.length - 1) / 2
  if (Number.isInteger(half)) return stripPrefix(rest.slice(half + 1))
  return stripPrefix(rest.slice(rest.lastIndexOf(' b/') + 1))
}

/**
 * Splits a patch that touches several files, such as a commit or a stash,
 * into one part per file. Anything before the first file, like the commit
 * message `git show` prints, comes back as `preamble`.
 */
export function splitDiff(patch: string): {
  preamble: string
  files: FileDiff[]
} {
  const lines = patch.split('\n')
  const starts: number[] = []
  lines.forEach((l, i) => l.startsWith('diff --git ') && starts.push(i))
  if (starts.length === 0) return { preamble: patch, files: [] }

  const preamble = lines.slice(0, starts[0]).join('\n').trimEnd()
  const files = starts.map((start, n) => {
    const end = n + 1 < starts.length ? starts[n + 1] : lines.length
    const part = lines.slice(start, end)
    while (part.length > 1 && part[part.length - 1] === '') part.pop()

    let path = pathFromDiffLine(part[0])
    let oldPath: string | undefined
    let status: FileStatus = 'modified'
    let binary = false
    let additions = 0
    let deletions = 0
    let inHunk = false

    for (const l of part.slice(1)) {
      if (inHunk || l.startsWith('@@')) {
        inHunk = true
        if (l.startsWith('+')) additions++
        else if (l.startsWith('-')) deletions++
      } else if (l.startsWith('new file mode')) status = 'added'
      else if (l.startsWith('deleted file mode')) status = 'deleted'
      else if (l.startsWith('rename from ')) {
        status = 'renamed'
        oldPath = unquotePath(l.slice('rename from '.length))
      } else if (l.startsWith('rename to '))
        path = unquotePath(l.slice('rename to '.length))
      else if (l.startsWith('copy from ')) {
        status = 'copied'
        oldPath = unquotePath(l.slice('copy from '.length))
      } else if (l.startsWith('copy to '))
        path = unquotePath(l.slice('copy to '.length))
      else if (l.startsWith('+++ ') && l !== '+++ /dev/null')
        path = stripPrefix(l.slice(4))
      else if (l.startsWith('--- ') && status === 'deleted')
        path = stripPrefix(l.slice(4))
      else if (l.startsWith('Binary files') || l === 'GIT binary patch')
        binary = true
    }

    return {
      path,
      oldPath,
      status,
      additions,
      deletions,
      binary,
      diff: part.join('\n') + '\n',
    }
  })
  return { preamble, files }
}

export interface DiffLine {
  kind: 'add' | 'remove' | 'context'
  text: string
}

/** Line-by-line differences between two texts, via their longest common
 *  subsequence. */
// ponytail: O(n·m) table, fine for commit messages and conflict blocks;
// switch to Myers' algorithm before using it on whole files.
export function diffLines(before: string[], after: string[]): DiffLine[] {
  const n = before.length
  const m = after.length
  const lcs = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(0),
  )
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      lcs[i][j] =
        before[i] === after[j]
          ? lcs[i + 1][j + 1] + 1
          : Math.max(lcs[i + 1][j], lcs[i][j + 1])

  const out: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (before[i] === after[j]) {
      out.push({ kind: 'context', text: before[i] })
      i++
      j++
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      out.push({ kind: 'remove', text: before[i++] })
    } else {
      out.push({ kind: 'add', text: after[j++] })
    }
  }
  while (i < n) out.push({ kind: 'remove', text: before[i++] })
  while (j < m) out.push({ kind: 'add', text: after[j++] })
  return out
}

/** Part of a changed line; `changed` parts get a stronger highlight. */
export interface Segment {
  text: string
  changed: boolean
}

/** Past this many tokens per line, word highlights aren't worth the cost. */
const MAX_TOKENS = 400

/** Words, runs of whitespace, and single other characters. */
const tokenize = (s: string) => s.match(/\w+|\s+|[^\w\s]/g) ?? []

function merge(segments: Segment[], text: string, changed: boolean) {
  const last = segments[segments.length - 1]
  if (last && last.changed === changed) last.text += text
  else segments.push({ text, changed })
}

/**
 * Which words differ between a removed line and the added line that
 * replaced it. Null when the lines have too little in common for word
 * highlights to help, or are too long to compare cheaply.
 */
export function wordDiff(
  before: string,
  after: string,
): [Segment[], Segment[]] | null {
  const a = tokenize(before)
  const b = tokenize(after)
  if (a.length > MAX_TOKENS || b.length > MAX_TOKENS) return null

  const steps = diffLines(a, b)
  const left: Segment[] = []
  const right: Segment[] = []
  let same = 0
  for (const s of steps) {
    if (s.kind === 'context') {
      if (s.text.trim()) same += s.text.length
      merge(left, s.text, false)
      merge(right, s.text, false)
    } else if (s.kind === 'remove') merge(left, s.text, true)
    else merge(right, s.text, true)
  }
  // Mostly rewritten: highlighting nearly everything is just noise.
  const visible = (t: string) => t.replace(/\s+/g, '').length
  const longest = Math.max(visible(before), visible(after))
  if (longest === 0 || same / longest < 0.4) return null
  return [left, right]
}

/** A run of removals followed by additions, in one hunk. */
function changeBlocks(lines: Line[]) {
  const blocks: { removed: Line[]; added: Line[] }[] = []
  let current: { removed: Line[]; added: Line[] } | null = null
  for (const l of lines) {
    if (l.kind === 'remove') {
      if (!current || current.added.length) {
        current = { removed: [], added: [] }
        blocks.push(current)
      }
      current.removed.push(l)
    } else if (l.kind === 'add') {
      if (!current) {
        current = { removed: [], added: [] }
        blocks.push(current)
      }
      current.added.push(l)
    } else current = null
  }
  return blocks
}

/** Word highlights for every changed line that has a counterpart: the n-th
 *  removal of a block is paired with its n-th addition. Keyed by line index. */
export function wordHighlights(lines: Line[]): Map<number, Segment[]> {
  const out = new Map<number, Segment[]>()
  for (const { removed, added } of changeBlocks(lines)) {
    const n = Math.min(removed.length, added.length)
    for (let i = 0; i < n; i++) {
      const pair = wordDiff(removed[i].text, added[i].text)
      if (!pair) continue
      out.set(removed[i].index, pair[0])
      out.set(added[i].index, pair[1])
    }
  }
  return out
}

/** One row of a side-by-side diff. Hunk and meta lines span both sides. */
export type SplitRow =
  | { kind: 'full'; line: Line }
  | { kind: 'pair'; left?: Line; right?: Line; key: number }

/** Lays a parsed diff out side by side: context on both sides, removals on
 *  the left next to the additions that replaced them on the right. */
export function splitRows(lines: Line[]): SplitRow[] {
  const rows: SplitRow[] = []
  let removed: Line[] = []
  let added: Line[] = []
  const flush = () => {
    const n = Math.max(removed.length, added.length)
    for (let i = 0; i < n; i++) {
      const left = removed[i]
      const right = added[i]
      rows.push({ kind: 'pair', left, right, key: (left ?? right)!.index })
    }
    removed = []
    added = []
  }
  for (const l of lines) {
    if (l.kind === 'remove') {
      if (added.length) flush()
      removed.push(l)
    } else if (l.kind === 'add') added.push(l)
    else {
      flush()
      if (l.kind === 'context')
        rows.push({ kind: 'pair', left: l, right: l, key: l.index })
      else rows.push({ kind: 'full', line: l })
    }
  }
  flush()
  return rows
}
