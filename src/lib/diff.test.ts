import { describe, expect, it } from 'vitest'
import { parseDiff } from './diff'

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
