// The sticky header over a merge conflict keeps the name of the file it is
// resolving, at the app's own minimum window.
//
// The row was `flex flex-wrap` whose first item was `flex-1` with `min-w-0`,
// so that item got whatever the buttons left over: at 800x500 the three
// resolution buttons took the first line and the path was one character wide
// (clientWidth 33 for a scrollWidth of 635). The fix gives the name its own
// line and keeps the buttons in a group beside each other, their labels
// ellipsizing instead of pushing the name out. This spec is the number that
// held the bug, as the issue's own gate: the name's clientWidth against 0.6
// of the row width, plus the header still inside two lines.
//
// The conflict is real, made by git in the fixture, and the path is a long
// Turkish one so nothing can be blamed on a short name.
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { launch, openFixture, repo } from '../lab.mjs'

const git = (...args) =>
  execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim()

const commit = (message) =>
  git(
    '-c',
    'user.name=App Lab',
    '-c',
    'user.email=applab@example.com',
    'commit',
    '-qm',
    message,
  )

/** The path the changes panel lists, and the name the header must keep. */
const CONFLICT =
  'src/ozellikler/kullanici-yonetimi/bilesenler/kullanici-oturum-acma-formu-bileseni.tsx'
const NAME = 'kullanici-oturum-acma-formu-bileseni.tsx'

function write(path, body) {
  mkdirSync(path.split('/').slice(0, -1).join('/'), { recursive: true })
  writeFileSync(path, body)
  git('add', '-A')
}

/**
 * Puts the same file on two branches and merges them, so the window opens
 * mid-merge with a conflicted file in the changes panel.
 */
function seedConflict() {
  write(`${repo}/${CONFLICT}`, 'export const form = 1\n')
  commit('add the long path component')

  git('checkout', '-q', '-b', 'conflict/long-path')
  write(`${repo}/${CONFLICT}`, 'export const form = 2\n')
  commit('the other side')

  git('checkout', '-q', 'main')
  write(`${repo}/${CONFLICT}`, 'export const form = 3\n')
  commit('this side')

  try {
    git('merge', 'conflict/long-path')
  } catch {
    // The conflict is the point.
  }
  const status = git('status', '--porcelain')
  if (!status.includes(CONFLICT)) {
    throw new Error(`git left no conflict in ${CONFLICT}: ${status}`)
  }
}

/** Clicks the conflicted file in the changes panel, if it is listed. */
async function openConflict(browser) {
  const opened = await browser.execute((name) => {
    const row = [...document.querySelectorAll('aside li')].find((el) =>
      (el.innerText || '').includes(name),
    )
    if (!row) return false
    row.click()
    return true
  }, NAME)
  if (!opened) throw new Error(`the changes panel never listed ${NAME}`)

  await browser.waitUntil(
    async () =>
      (await browser.execute(
        () => document.querySelectorAll('section.isolate .sticky').length,
      )) > 0,
    { timeout: 30000, timeoutMsg: 'the conflict view never rendered' },
  )
}

/**
 * The name cell's room against the header row, and how many lines the header
 * really takes: the distinct rows the name and the three buttons sit on, so a
 * button that wrapped would count as a third line.
 */
const HEADER = () => {
  const row = document.querySelector('section.isolate .sticky')
  const name = row?.querySelector('span.truncate')
  if (!row || !name) return null
  const buttons = [...row.querySelectorAll('button')]
  // Lines, not tops: two cells share a line when their vertical extents
  // overlap, so a button a pixel taller than its neighbours does not read as a
  // line of its own, while one that wrapped does.
  const bands = [name, ...buttons]
    .map((el) => {
      const r = el.getBoundingClientRect()
      return [r.top, r.bottom]
    })
    .sort((a, b) => a[0] - b[0])
  let lines = 0
  let bottom = -Infinity
  for (const [top, end] of bands) {
    if (top >= bottom) lines += 1
    bottom = Math.max(bottom, end)
  }
  return {
    rowW: Math.round(row.getBoundingClientRect().width),
    rowH: Math.round(row.getBoundingClientRect().height),
    nameCW: name.clientWidth,
    title: name.title,
    lines,
    titled: buttons.every((b) => b.title && b.title.length > 0),
  }
}

/**
 * Reloads the window in `locale`, on the fixture, without a click on the app.
 *
 * The lab's own `openFixture` waits for the English toolbar, so it cannot be
 * used once the language changes. The app opens its most recent repository by
 * itself, and `openFixture` has already made the fixture that one, so the
 * reload lands on the repository view; the click below is only for the
 * startup that lands on the start screen instead. The recents row is scoped to
 * the start screen's own list, or its title would also match the toolbar's
 * repository button on a window that is already open.
 */
async function reopenIn(browser, locale) {
  await browser.execute(
    (code) => localStorage.setItem('gitgud.locale', code),
    locale,
  )
  await browser.refresh()
  await browser.waitUntil(
    async () => {
      const painted = await browser.execute(() => ({
        rows: document.querySelectorAll('aside li').length,
        recent: document.querySelectorAll('main ul button[title]').length,
      }))
      return painted.rows > 0 || painted.recent > 0
    },
    { timeout: 30000, timeoutMsg: 'the window never painted' },
  )
  await browser.execute((path) => {
    document.querySelector(`main ul button[title="${path}"]`)?.click()
  }, repo)
  await browser.waitUntil(
    async () =>
      (await browser.execute(
        () => document.querySelectorAll('aside li').length,
      )) > 0,
    {
      timeout: 30000,
      timeoutMsg: `the repository view never appeared in ${locale}`,
    },
  )
}

const browser = await launch()
try {
  seedConflict()
  await openFixture(browser)
  await openConflict(browser)

  // The app's own minimum window, whatever the session inherited.
  await browser.setWindowSize(800, 500)
  await browser.pause(600)

  // Both languages the fix has to hold in: Turkish labels are the longest
  // this app ships, and English is what the lab starts in.
  for (const locale of ['en', 'tr']) {
    if (locale !== 'en') {
      await reopenIn(browser, locale)
      await openConflict(browser)
      await browser.setWindowSize(800, 500)
      await browser.pause(600)
    }

    const header = await browser.execute(HEADER)
    if (!header)
      throw new Error(`the conflict header never rendered in ${locale}`)

    const share = header.nameCW / header.rowW
    if (share < 0.6) {
      throw new Error(
        `${locale}: the name is ${header.nameCW}px of a ${header.rowW}px header at ` +
          `800x500 (${Math.round(share * 100)}%, the gate is 60%)`,
      )
    }
    if (header.lines > 2) {
      throw new Error(
        `${locale}: the header takes ${header.lines} lines at 800x500, not the two ` +
          `it has room for`,
      )
    }
    if (!header.titled) {
      throw new Error(
        `${locale}: a resolution button lost the full label in its title`,
      )
    }
    if (header.title !== CONFLICT) {
      throw new Error(
        `${locale}: the name cell titles ${header.title}, not the full path`,
      )
    }
    console.log(
      `  ok: ${locale} name ${header.nameCW}px of ${header.rowW}px ` +
        `(${Math.round(share * 100)}%), header ${header.rowH}px on ` +
        `${header.lines} lines at 800x500`,
    )
    console.log(`  ok: ${locale} name cell keeps the whole path in its title`)
  }

  // The fix's own frame for the pull request body: the window at the size the
  // gate is about, nothing open over it.
  const shot = `${process.env.LAB_WORK}/conflict-header-800x500.png`
  await browser.saveScreenshot(shot)
  console.log(`  shot ${shot}`)
} finally {
  await browser.deleteSession()
}
