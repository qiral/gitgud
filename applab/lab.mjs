// The one thing the specs share: a WebDriver session on the running app.
//
// Two settings are not optional. `wdio:enforceWebDriverClassic` keeps
// webdriverio from asking for a BiDi socket, which WebKitWebDriver does not
// serve; without it the session request fails before the app is even
// mentioned. `tauri:options.application` is what tauri-driver turns into the
// native driver's `webkitgtk:browserOptions`, i.e. the binary to launch.
import { remote } from 'webdriverio'

const binary = process.env.LAB_APP_BINARY
const port = Number(process.env.LAB_DRIVER_PORT)
const repo = process.env.LAB_REPO

if (!binary || !port || !repo) {
  throw new Error('run this through applab/run.sh, which sets up the lab')
}

/**
 * Launches the app and waits until the UI has painted.
 *
 * No argv, so the window opens on the start screen rather than on a
 * repository, and the specs decide what to open from there.
 */
export async function launch() {
  const browser = await remote({
    hostname: '127.0.0.1',
    port,
    capabilities: {
      'wdio:enforceWebDriverClassic': true,
      'tauri:options': { application: binary },
    },
    logLevel: 'warn',
  })

  // The window exists before the React tree does; the root div is painted
  // empty for a moment. Wait for text instead of a timeout.
  await browser.waitUntil(
    async () => (await browser.execute(() => document.body.innerText.length)) > 0,
    { timeout: 30000, timeoutMsg: 'the app never painted any text' },
  )

  return browser
}

/** The whole visible text of the window, the cheapest assertion there is. */
export const text = (browser) =>
  browser.execute(() => document.body.innerText)

/** A button whose whole text contains `label` as typed. */
export const button = (browser, label) =>
  browser.$(`//button[contains(normalize-space(.), ${JSON.stringify(label)})]`)

/**
 * Opens the fixture repository the way a user does, without the native
 * picker: the start screen lists recents from localStorage, so write one and
 * reload. The click goes through the same `open_repo` command a picker makes.
 */
export async function openFixture(browser) {
  await browser.execute((path) => {
    const name = path.split('/').pop()
    localStorage.setItem(
      'gitgud.recentRepos',
      JSON.stringify([{ path, name }]),
    )
  }, repo)

  await browser.refresh()
  // The app reopens the last repository by itself, and that is the recent
  // just written. Only the start screen needs a click, and only on its own
  // list: the toolbar's Repository button carries the same title, and a
  // click there opens its menu over the tabs.
  const recent = await browser.$(`li > button[title="${repo}"]`)
  const opened = async () => (await text(browser)).includes('Current branch')
  await browser.waitUntil(
    async () => (await opened()) || (await recent.isDisplayed()),
    { timeout: 30000, timeoutMsg: 'neither the start screen nor the repository showed up' },
  )
  if (!(await opened())) await recent.click()

  await browser.waitUntil(
    async () => (await text(browser)).includes('Current branch'),
    { timeout: 30000, timeoutMsg: 'the repository view never appeared' },
  )
}

/** The fixture repository this spec runs against. */
export { repo }
