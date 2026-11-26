// The history search, on a language that is not ASCII.
//
// The field promises a search that ignores case. git runs under `LC_ALL=C`, so
// its own matching folds ASCII only; the app folds both sides itself, in Rust,
// and this is the check that it does. Written by hand in the window, against a
// repository whose commits and author are Turkish.
import { execFileSync } from 'node:child_process'
import { launch, openFixture, repo, text } from '../lab.mjs'

const git = (...args) =>
  execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim()

const subject = 'ÖDEME akışı eklendi'
git('commit', '-q', '--allow-empty', '-m', subject)
git('commit', '-q', '--allow-empty', '-m', 'İSTANBUL gezisi')
// The fixture's author is ASCII; this one is not, and the search covers both.
git(
  'commit',
  '-q',
  '--allow-empty',
  '--author=Özlem Yıldız <ozlem@example.com>',
  '-m',
  'yazar imzası',
)

const search = async (browser, query) => {
  const field = await browser.$('input[aria-label="Search commits"]')
  await field.waitForDisplayed({ timeout: 30000 })
  await field.setValue(query)
  // The window waits for a pause in typing, then runs the search.
  await browser.pause(1500)
  return text(browser)
}

const expectShown = async (browser, query, needle, what) => {
  const shown = await search(browser, query)
  if (!shown.includes(needle)) {
    throw new Error(
      `${what}: searching ${JSON.stringify(query)} never showed ${JSON.stringify(needle)}`,
    )
  }
  console.log(
    `  ok: ${what} (${JSON.stringify(query)} finds ${JSON.stringify(needle)})`,
  )
}

const expectHidden = async (browser, query, needle, what) => {
  const shown = await search(browser, query)
  if (shown.includes(needle)) {
    throw new Error(
      `${what}: searching ${JSON.stringify(query)} still showed ${JSON.stringify(needle)}`,
    )
  }
  console.log(
    `  ok: ${what} (${JSON.stringify(query)} does not find ${JSON.stringify(needle)})`,
  )
}

const browser = await launch()
try {
  await openFixture(browser)

  // Clicked from the page, not through the driver: the tab row sits under the
  // window's own header, and a driver click on it lands on the header instead.
  await browser.execute(() => {
    const tab = [...document.querySelectorAll('button')].find((b) =>
      b.innerText.trim().startsWith('History'),
    )
    tab?.click()
  })
  await browser.pause(400)

  // A lowercase query against a subject typed in capitals.
  await expectShown(
    browser,
    'ödeme',
    'ÖDEME',
    'a lowercase query finds a capitalised subject',
  )
  await expectShown(
    browser,
    'AKIŞI',
    'akışı',
    'a capitalised query finds a lowercase subject',
  )
  // The dotted capital, which is the letter a simple lowercase gets wrong.
  await expectShown(
    browser,
    'istanbul',
    'İSTANBUL',
    'a lowercase query finds the dotted capital I',
  )
  // The author's name, in the same two directions.
  await expectShown(
    browser,
    'özlem',
    'Özlem',
    'a lowercase query finds a capitalised author',
  )
  await expectShown(
    browser,
    'YILDIZ',
    'Yıldız',
    'a capitalised query finds a lowercase author',
  )

  // The search is still a search: a query that matches nothing shows nothing.
  await expectHidden(
    browser,
    'zzzz',
    'ÖDEME',
    'a query that matches nothing hides it again',
  )

  // And git agrees the fixture holds what this spec searched for, so the spec
  // fails on a fixture that changed rather than on a window that did.
  const authors = git('log', '--format=%an')
  if (!authors.includes('Özlem Yıldız')) {
    throw new Error(
      `git has no Özlem Yıldız commit; authors are ${JSON.stringify(authors)}`,
    )
  }
  const subjects = git('log', '--format=%s')
  if (!subjects.includes(subject)) {
    throw new Error(`git has no ${JSON.stringify(subject)} commit`)
  }
  console.log(
    '  ok: git has the Turkish commit and author this spec searched for',
  )
} finally {
  await browser.deleteSession()
}
