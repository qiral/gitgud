// A staged rename, read back off the screen and off the disk.
//
// The fixture gets a rename staged the way a user does it (`git mv`). Two
// things are asserted. First the diff the app shows for that row: it has to
// name both paths, `rename from` the old one and `rename to` the new one, and
// not mistake the file for a new one. Second what the index looks like after
// the row's unstage button is pressed: the same as before the rename, with no
// delete left behind for the old path.
//
// The disk is the assertion wherever it can be. The app saying "unstaged" is
// not the same as `git` agreeing, and the bug this spec pins down was exactly
// a case where it did not.
import { execFileSync } from 'node:child_process'
import { launch, openFixture, repo, text } from '../lab.mjs'

const git = (...args) =>
  execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim()

/** `git status --porcelain=v2` entries, header lines dropped. */
const status = () =>
  execFileSync('git', ['-C', repo, 'status', '--porcelain=v2', '-z'], {
    encoding: 'utf8',
  })
    .split('\0')
    .filter((entry) => /^[12u?] /.test(entry))

/** The index status letter of a renamed or changed row, `.` when unchanged. */
const indexLetter = (entry) => entry.split(' ')[1][0]

execFileSync('git', [
  '-C',
  repo,
  'mv',
  'docs/notes.md',
  'docs/notes-renamed.md',
])

const staged = status().find((entry) => entry.startsWith('2 '))
if (!staged || indexLetter(staged) !== 'R') {
  throw new Error(
    `the fixture did not stage a rename: ${JSON.stringify(status())}`,
  )
}
console.log('  ok: git has the rename staged, R in the index')

const browser = await launch()
try {
  await openFixture(browser)
  await browser.execute(() => {
    const tab = [...document.querySelectorAll('button')].find((b) =>
      b.innerText.trim().startsWith('Changes'),
    )
    tab?.click()
  })
  await browser.pause(600)

  const clicked = await browser.execute(() => {
    const li = [...document.querySelectorAll('li')].find((l) =>
      l.innerText.includes('notes-renamed.md'),
    )
    if (!li) return 'no row'
    li.click()
    return 'clicked'
  })
  if (clicked !== 'clicked') {
    throw new Error('the staged rename has no row in Changes')
  }
  await browser.pause(1200)

  // The diff names both ends of the rename, and names them as a rename. A
  // new-file header here is the bug: it also turns the old file's lines into
  // fabricated additions.
  const diff = await browser.execute(() =>
    [...document.querySelectorAll('tr')].map((tr) => tr.innerText).join('\n'),
  )
  for (const line of [
    'rename from docs/notes.md',
    'rename to docs/notes-renamed.md',
  ]) {
    if (!diff.includes(line)) {
      throw new Error(`the diff never says ${JSON.stringify(line)}:\n${diff}`)
    }
  }
  if (diff.includes('new file mode')) {
    throw new Error(`a rename was rendered as a new file:\n${diff}`)
  }
  console.log(
    '  ok: the diff says rename from docs/notes.md, rename to docs/notes-renamed.md',
  )

  // And the header above it shows the move, old path on the left.
  const header = (await text(browser))
    .split('\n')
    .find((line) => line.includes('→') && line.includes('notes'))
  if (
    !header ||
    !header.includes('docs/notes.md') ||
    !header.includes('notes-renamed.md')
  ) {
    throw new Error(
      `the file header does not name both paths: ${JSON.stringify(header)}`,
    )
  }
  console.log(`  ok: the header names both paths, ${JSON.stringify(header)}`)

  // Unstaging the row has to put the index back, not leave the old path
  // deleted in it. From here on, only git is believed.
  const pressed = await browser.execute(() => {
    const li = [...document.querySelectorAll('li')].find((l) =>
      l.innerText.includes('notes-renamed.md'),
    )
    const target =
      li &&
      [...li.querySelectorAll('button')].find((b) => /unstage/i.test(b.title))
    if (!target) return null
    target.click()
    return target.title
  })
  if (!pressed) throw new Error('the rename row has no unstage button')

  // Let the command run and the list refresh off it.
  await browser.pause(1500)

  const after = status()
  const phantom = after.filter((entry) => indexLetter(entry) === 'D')
  if (phantom.length > 0) {
    throw new Error(
      `unstaging the rename left a delete in the index: ${JSON.stringify(phantom)} (whole status: ${JSON.stringify(after)})`,
    )
  }
  const cached = git('diff', '--cached', '--name-status')
  if (cached !== '') {
    throw new Error(`the index is not back to HEAD: ${JSON.stringify(cached)}`)
  }
  const tracked = git('ls-files', '--', 'docs/notes.md')
  if (tracked !== 'docs/notes.md') {
    throw new Error(
      `docs/notes.md is no longer tracked after the unstage: ${JSON.stringify(tracked)}`,
    )
  }
  console.log(
    `  ok: nothing staged, docs/notes.md still tracked, status ${JSON.stringify(after)}`,
  )
} finally {
  await browser.deleteSession()
}
