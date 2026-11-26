// A branch that a tag is also called.
//
// `git for-each-ref` prints a short ref name by resolving it against every
// ref, so a tag called like a branch turns that branch into `heads/<name>`.
// The branch menu is drawn from that output, and the row is handed back to
// `git switch` on the click, so a shadowed branch used to list under a name
// git refuses and the click did nothing. The branch is still a branch: this
// spec asks git and the window the same question about it.
//
// The fixture has no shape for a tag, so the tag is made here, on the branch's
// own commit, before the window is opened.
import { execFileSync } from 'node:child_process'
import { button, launch, openFixture, repo, text } from '../lab.mjs'

const git = (...args) =>
  execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim()

const branch = 'feature/login'
git('tag', branch, branch)

const browser = await launch()
try {
  await openFixture(browser)

  await (await button(browser, 'Current branch')).click()
  const filter = await browser.$('input[placeholder="Filter or create a branch"]')
  await filter.waitForDisplayed({ timeout: 30000 })

  const rows = await browser.execute(() =>
    [...document.querySelectorAll('ul > li > button:first-child')].map((b) =>
      b.innerText.trim(),
    ),
  )
  const names = git('branch', '--format=%(refname:lstrip=2)').split('\n')
  console.log(`  git branches: ${JSON.stringify(names)}`)
  console.log(`  menu rows:    ${JSON.stringify(rows)}`)

  // Listed under its own name, not `heads/` prefixed and not left out.
  for (const name of names) {
    if (!rows.includes(name)) {
      throw new Error(
        `the branch menu is missing ${JSON.stringify(name)}; it lists ${JSON.stringify(rows)}`,
      )
    }
  }
  console.log(`  ok: ${names.length} branches listed by their own names`)

  // And selecting it switches: the row goes through `git switch`.
  const row = await browser.$(`//button[normalize-space(.)="${branch}"]`)
  await row.click()
  // The window's own report is not the assertion: the disk is. Not
  // `rev-parse --abbrev-ref`, which is the same ambiguous lookup under test.
  await browser.waitUntil(
    () => git('branch', '--show-current') === branch,
    { timeout: 30000, timeoutMsg: `HEAD never moved to ${branch}` },
  )
  console.log(`  ok: clicking the row switched HEAD to ${branch}`)

  const shown = await text(browser)
  if (!shown.includes(branch)) {
    throw new Error(`the toolbar does not name ${branch} after the switch`)
  }
  console.log(`  ok: the toolbar names ${branch}`)
} finally {
  await browser.deleteSession()
}
