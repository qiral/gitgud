// A write, through the UI, checked on disk.
//
// The branch menu's input filters the branches and creates one on Enter. What
// the app reports is not the assertion: the assertion is `git` in the fixture
// afterwards, which the app never saw.
import { execFileSync } from 'node:child_process'
import { button, launch, openFixture, repo, text } from '../lab.mjs'

const git = (...args) =>
  execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim()

const browser = await launch()
try {
  await openFixture(browser)

  const created = 'lab/created-by-ui'
  await (await button(browser, 'Current branch')).click()
  const filter = await browser.$('input[placeholder="Filter or create a branch"]')
  await filter.waitForDisplayed({ timeout: 30000 })
  await filter.setValue(created)
  await browser.keys(['Enter'])

  // The app switches to a new branch and says so in the toolbar.
  await browser.waitUntil(
    async () => (await text(browser)).includes(created),
    { timeout: 30000, timeoutMsg: `the toolbar never showed ${created}` },
  )

  const head = git('rev-parse', '--abbrev-ref', 'HEAD')
  if (head !== created) {
    throw new Error(`HEAD on disk is ${head}, not ${created}`)
  }
  console.log(`  ok: git says HEAD is ${head}`)

  // And it is a real branch with main's tip, made by the app's own command.
  const tip = git('rev-parse', created)
  const main = git('rev-parse', 'main')
  if (tip !== main) {
    throw new Error(`${created} is at ${tip}, main at ${main}`)
  }
  console.log(`  ok: ${created} points at main's tip, ${tip.slice(0, 7)}`)
} finally {
  await browser.deleteSession()
}
