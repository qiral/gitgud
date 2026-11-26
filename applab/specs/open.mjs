// Open a repository through the UI and read it back off the screen.
//
// This is the first test in the repo that crosses the whole chain: a click in
// the window, the IPC, the Rust command, `git` on disk, and the answer
// rendered. The mocked e2e specs answer `log` and `branches` from a table;
// here the fixture repository is the only source for either.
import { execFileSync } from 'node:child_process'
import { button, launch, openFixture, repo, text } from '../lab.mjs'

const git = (...args) =>
  execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim()

const browser = await launch()
try {
  await openFixture(browser)
  const shown = await text(browser)

  // Commits: the fixture's subjects, straight from git, all of them on screen.
  const subjects = git('log', '--format=%s', 'main').split('\n')
  for (const subject of subjects) {
    if (!shown.includes(subject)) {
      throw new Error(`history is missing ${JSON.stringify(subject)}`)
    }
  }
  console.log(`  ok: ${subjects.length} commits from git rendered in the history`)

  // Branches: the menu lists what git lists.
  await (await button(browser, 'Current branch')).click()
  const filter = await browser.$('input[placeholder="Filter or create a branch"]')
  await filter.waitForDisplayed({ timeout: 30000 })

  const rows = await browser.execute(() =>
    // The list right after the filter's form, found by its place rather
    // than its classes, which change with the layout.
    [
      ...document.querySelectorAll(
        'form:has(input[placeholder="Filter or create a branch"]) + ul > li > button:first-child',
      ),
    ].map(
      (b) => b.innerText.trim(),
    ),
  )

  const names = git('branch', '--format=%(refname:short)').split('\n')
  for (const name of names) {
    if (!rows.includes(name)) {
      throw new Error(
        `the branch menu is missing ${JSON.stringify(name)}; it lists ${JSON.stringify(rows)}`,
      )
    }
  }
  console.log(`  ok: ${names.length} branches listed, matching git`)
} finally {
  await browser.deleteSession()
}
