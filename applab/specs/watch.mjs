// Changes made behind the app's back show up without touching the app.
//
// The file is written and the commit made here, with node and the git CLI,
// the way an editor or a terminal would. The app hears about them only from
// its watcher (src-tauri/src/watch.rs): nothing clicks a refresh, and the
// lab's display never moves the focus.
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { button, launch, openFixture, repo, text } from '../lab.mjs'

const git = (...args) =>
  execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim()

const shows = (browser, what, timeoutMsg) =>
  browser.waitUntil(async () => (await text(browser)).includes(what), {
    timeout: 10000,
    timeoutMsg,
  })

const browser = await launch()
try {
  await openFixture(browser)

  // Switching tabs only shows what's already loaded.
  await (await button(browser, 'Changes')).click()
  writeFileSync(join(repo, 'from-an-editor.txt'), 'saved elsewhere\n')
  await shows(browser, 'from-an-editor.txt', 'the new file never showed up in Changes')
  console.log('  ok: a file written on disk showed up in Changes')

  const subject = 'committed in a terminal'
  git('add', '-A')
  git('commit', '-qm', subject)
  await (await button(browser, 'History')).click()
  await shows(browser, subject, 'the commit never showed up in History')
  console.log('  ok: a commit made with git showed up in History')

  git('switch', '-qc', 'lab/switched-outside')
  await shows(browser, 'lab/switched-outside', 'the toolbar never showed the new branch')
  console.log('  ok: a branch switch made with git showed up in the toolbar')
} finally {
  await browser.deleteSession()
}
