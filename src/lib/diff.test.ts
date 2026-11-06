import { describe, expect, it } from 'vitest'
import { parseDiff, splitDiff, unquotePath } from './diff'

// The same new-file diff as NEW_FILE in src-tauri/src/patch.rs. The backend
// picks lines by their index in diff.split('\n'), so the indexes the
// frontend sends must line up with that test: 6, 7 and 8 are the additions.
const NEW_FILE = `diff --git a/n x.txt b/n x.txt
new file mode 100644
index 0000000..3333333
--- /dev/null
+++ b/n x.txt\t
@@ -0,0 +1,3 @@
+a
+b
+c
`

const MODIFIED = `diff --git a/f.txt b/f.txt
index 1111111..2222222 100644
--- a/f.txt
+++ b/f.txt
@@ -1,4 +1,4 @@
 one
-two
+TWO
 three
@@ -10,2 +10,3 @@ ten
 ten
+ten and a half
 eleven
\\ No newline at end of file
`

describe('parseDiff', () => {
  it('numbers lines the way the backend does', () => {
    const lines = parseDiff(NEW_FILE)
    const adds = lines.filter((l) => l.kind === 'add')
    expect(adds.map((l) => l.index)).toEqual([6, 7, 8])
    const raw = NEW_FILE.split('\n')
    for (const l of lines) expect(raw[l.index]).toContain(l.text)
  })

  it('tracks old and new line numbers per hunk', () => {
    const lines = parseDiff(MODIFIED)
    const byText = (t: string) => lines.find((l) => l.text === t)!
    expect(byText('two')).toMatchObject({ kind: 'remove', oldNo: 2, hunk: 0 })
    expect(byText('TWO')).toMatchObject({ kind: 'add', newNo: 2, hunk: 0 })
    expect(byText('three')).toMatchObject({ oldNo: 3, newNo: 3 })
    expect(byText('ten and a half')).toMatchObject({
      kind: 'add',
      newNo: 11,
      hunk: 1,
    })
  })

  it('keeps headers and markers as meta, and drops the trailing empty line', () => {
    const lines = parseDiff(MODIFIED)
    expect(lines.slice(0, 4).every((l) => l.kind === 'meta')).toBe(true)
    expect(lines.filter((l) => l.kind === 'hunk')).toHaveLength(2)
    expect(lines[lines.length - 1]).toMatchObject({
      kind: 'meta',
      text: '\\ No newline at end of file',
    })
  })
})

const COMMIT = `make the thing work

Longer explanation.

diff --git a/src/a.ts b/src/a.ts
index 1111111..2222222 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,2 +1,3 @@
 one
-two
+TWO
+three
diff --git a/new.txt b/new.txt
new file mode 100644
index 0000000..3333333
--- /dev/null
+++ b/new.txt
@@ -0,0 +1 @@
+hello
diff --git a/gone.txt b/gone.txt
deleted file mode 100644
index 4444444..0000000
--- a/gone.txt
+++ /dev/null
@@ -1 +0,0 @@
-bye
diff --git a/old name.md b/docs/new name.md
similarity 90%
rename from old name.md
rename to docs/new name.md
diff --git a/logo.png b/logo.png
index 5555555..6666666 100644
Binary files a/logo.png and b/logo.png differ
diff --git a/run.sh b/run.sh
old mode 100644
new mode 100755
diff --git "a/t\\303\\244st.txt" "b/t\\303\\244st.txt"
index 7777777..8888888 100644
--- "a/t\\303\\244st.txt"
+++ "b/t\\303\\244st.txt"
@@ -1 +1 @@
-a
+b
`

describe('splitDiff', () => {
  const { preamble, files } = splitDiff(COMMIT)

  it('keeps the commit message apart from the files', () => {
    expect(preamble).toBe('make the thing work\n\nLonger explanation.')
  })

  it('finds every file with its status and line counts', () => {
    expect(
      files.map((f) => [f.path, f.status, f.additions, f.deletions]),
    ).toEqual([
      ['src/a.ts', 'modified', 2, 1],
      ['new.txt', 'added', 1, 0],
      ['gone.txt', 'deleted', 0, 1],
      ['docs/new name.md', 'renamed', 0, 0],
      ['logo.png', 'modified', 0, 0],
      ['run.sh', 'modified', 0, 0],
      ['täst.txt', 'modified', 1, 1],
    ])
    expect(files[3].oldPath).toBe('old name.md')
    expect(files[4].binary).toBe(true)
  })

  it('gives each file its own patch', () => {
    expect(files[1].diff).toBe(
      'diff --git a/new.txt b/new.txt\nnew file mode 100644\nindex 0000000..3333333\n--- /dev/null\n+++ b/new.txt\n@@ -0,0 +1 @@\n+hello\n',
    )
    expect(
      parseDiff(files[0].diff).filter((l) => l.kind === 'add'),
    ).toHaveLength(2)
  })

  it('handles a patch without files', () => {
    expect(splitDiff('just a message\n')).toEqual({
      preamble: 'just a message\n',
      files: [],
    })
  })
})

describe('unquotePath', () => {
  it('decodes octal escapes as UTF-8', () => {
    expect(unquotePath('"t\\303\\244st.txt"')).toBe('täst.txt')
    expect(unquotePath('"a\\tb\\"c\\\\d"')).toBe('a\tb"c\\d')
    expect(unquotePath('plain.txt')).toBe('plain.txt')
  })
})

it('reads paths with spaces from the +++ line', () => {
  expect(splitDiff(NEW_FILE).files[0].path).toBe('n x.txt')
})
