// A file whose name is not valid UTF-8 has to be actionable like any other.
//
// git reports such names as raw bytes; the backend used to read them with
// String::from_utf8_lossy, so the window listed U+FFFD and every action on
// the row died with "did not match any files". The name now travels as
// git's quoted form, the same thing `git status` prints, and goes back to
// git as the bytes it really is. This spec drives the window the way a
// user does and asserts the index on disk, which the app never sees.
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { launch, openFixture, repo, text } from '../lab.mjs'

// git's view of the worktree, read as bytes: the raw 0xe9 in the name
// survives as the latin1 character é, which is how the name was made.
const statusLines = () =>
  execFileSync('git', ['-C', repo, 'status', '--porcelain=v2'], {
    encoding: 'buffer',
  })
    .toString('latin1')
    .split('\n')
    .filter(Boolean)

// Latin-1 0xe9, which is not valid UTF-8 on its own: caf<0xe9>.txt.
// Without -z, git prints that name quoted, so that is what the truth on
// disk is compared with below.
const latin1Name = 'caf\xe9.txt'
const quotedName = '"caf\\351.txt"'
writeFileSync(
  Buffer.concat([
    Buffer.from(`${repo}/`),
    Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x2e, 0x74, 0x78, 0x74]),
  ]),
  'hello\n',
)
// A second, ordinary file, so the batch action has more than this row.
writeFileSync(`${repo}/plain.txt`, 'plain\n')

// Whether the row that mentions the name carries a button of this title.
const hasRowButton = (browser, title) =>
  browser.execute(
    (title) => {
      const li = [...document.querySelectorAll('li')].find((l) =>
        /caf/.test(l.innerText),
      )
      return Boolean(
        li &&
          [...li.querySelectorAll('button')].some(
            (b) => b.title.trim() === title,
          ),
      )
    },
    title,
  )

// Clicks that button, in the page, and says whether it was there.
const clickRowButton = (browser, title) =>
  browser.execute(
    (title) => {
      const li = [...document.querySelectorAll('li')].find((l) =>
        /caf/.test(l.innerText),
      )
      const target =
        li &&
        [...li.querySelectorAll('button')].find(
          (b) => b.title.trim() === title,
        )
      if (!target) return null
      target.click()
      return title
    },
    title,
  )

const browser = await launch()
try {
  await openFixture(browser)
  await browser.execute(() => {
    const tab = [...document.querySelectorAll('button')].find((b) =>
      b.innerText.trim().startsWith('Changes'),
    )
    tab?.click()
  })

  // The row lists git's quoted form, not a replacement character.
  await browser.waitUntil(
    async () => {
      const shown = await text(browser)
      return shown.includes('caf') && shown.includes('txt')
    },
    { timeout: 15000, timeoutMsg: 'the changes list never showed the file' },
  )
  const shown = await text(browser)
  if (shown.includes('\uFFFD')) {
    throw new Error('the window shows U+FFFD instead of the file name')
  }
  const row = shown.split('\n').find((l) => /caf/.test(l) && /txt/.test(l))
  if (!row || !row.includes('"caf\\351.txt"')) {
    throw new Error(
      `the window lists ${JSON.stringify(row)}, not git's quoted form`,
    )
  }
  console.log('  ok: the row carries the name as git prints it')

  // Selecting the row shows the file's content through its real name. The
  // diff renders as a table, so the sign and the text are separate cells:
  // the claim is the content on screen, not the exact "+hello" string.
  await browser.execute(() => {
    const li = [...document.querySelectorAll('li')].find((l) =>
      /caf/.test(l.innerText),
    )
    li?.click()
  })
  await browser.waitUntil(
    async () => {
      const shown = await text(browser)
      return shown.includes('hello') && shown.includes('caf')
    },
    {
      timeout: 15000,
      timeoutMsg: 'selecting the row never showed the file content',
    },
  )
  console.log('  ok: the diff view reads the file through its real name')

  // Stage it through the row's own button, the way a user does.
  const staged = await clickRowButton(browser, 'Stage')
  if (!staged) throw new Error('the row had no stage button')
  await browser.waitUntil(
    async () =>
      statusLines().some((l) => l.startsWith('1 A.') && l.includes(quotedName)),
    { timeout: 15000, timeoutMsg: 'git never saw the file staged' },
  )
  console.log(
    `  ok: staged through the window: ${JSON.stringify(
      statusLines().find((l) => l.includes(quotedName)),
    )}`,
  )

  // And back out again, from the staged list: the app's own refresh has to
  // move the row first, so wait for the button before clicking it.
  await browser.waitUntil(() => hasRowButton(browser, 'Unstage'), {
    timeout: 15000,
    timeoutMsg: 'the staged row never offered an unstage button',
  })
  const unstaged = await clickRowButton(browser, 'Unstage')
  if (!unstaged) throw new Error('the staged row had no unstage button')
  await browser.waitUntil(
    async () =>
      statusLines().some((l) => l.startsWith('?') && l.includes(quotedName)),
    { timeout: 15000, timeoutMsg: 'git never saw the file unstaged' },
  )
  console.log('  ok: unstaged through the window')

  // The batch action used to die on the same name: with it present, the
  // whole `git add` failed and nothing got staged at all. Wait for the
  // app's own view to have the row unstaged again, so the batch it sends
  // really includes it.
  await browser.waitUntil(() => hasRowButton(browser, 'Stage'), {
    timeout: 15000,
    timeoutMsg: 'the row never came back to the unstaged list',
  })
  const bulk = await browser.execute(() => {
    const target = [...document.querySelectorAll('button')].find(
      (b) => b.innerText.trim() === 'Stage all',
    )
    if (!target) return null
    target.click()
    return target.innerText.trim()
  })
  if (!bulk) throw new Error('no Stage all button')
  await browser.waitUntil(
    async () => {
      const lines = statusLines()
      return (
        lines.some((l) => l.startsWith('1 A.') && l.includes(quotedName)) &&
        lines.some((l) => l.startsWith('1 A.') && l.includes('plain.txt'))
      )
    },
    { timeout: 15000, timeoutMsg: 'Stage all never staged both files' },
  )
  console.log('  ok: Stage all staged the batch, this name included')

  // No pathspec failure ever reached the window.
  const after = await text(browser)
  const error = after.split('\n').find((l) => /fatal|did not match/i.test(l))
  if (error) {
    throw new Error(`the window showed an error: ${JSON.stringify(error)}`)
  }
  console.log('  ok: no pathspec error in the window, end to end')
} finally {
  await browser.deleteSession()
}
