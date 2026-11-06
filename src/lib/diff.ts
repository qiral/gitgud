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
