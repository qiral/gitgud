// The thinnest facts the app can offer: it launches, the window it paints is
// the start screen, and that screen fits a narrow window.
//
// Everything here is real: the debug binary, the Rust backend behind the IPC,
// the WebKit engine in the window. What is absent is the fake Tauri that
// e2e/fixtures/test.ts installs for Chromium and WebKit, so a page here that
// talks to nothing would fail the last check below instead of looking fine.
import { launch } from '../lab.mjs'

const browser = await launch()
try {
  const shown = await browser.execute(() => ({
    title: document.title,
    text: document.body.innerText,
    tauri: Boolean(window.isTauri || window.__TAURI_INTERNALS__),
  }))

  if (shown.title !== 'GitGud') {
    throw new Error(`the window title is ${JSON.stringify(shown.title)}`)
  }
  for (const line of ['Open repository', 'Clone repository']) {
    if (!shown.text.includes(line)) {
      throw new Error(`the start screen never showed ${JSON.stringify(line)}`)
    }
  }
  if (!shown.tauri) {
    throw new Error('the page has no Tauri bridge; is this the real app?')
  }
  console.log(`  ok: real window, title ${JSON.stringify(shown.title)}`)
  console.log('  ok: the start screen rendered with the real IPC behind it')

  // The app's own minimum window size, 800x600. Narrow widths are where this
  // layout has broken before, and one claim is enough: nothing hangs off the
  // side of the window.
  await browser.setWindowSize(800, 600)
  await browser.pause(300)
  const fit = await browser.execute(() => ({
    portrait: window.innerWidth,
    content: document.documentElement.scrollWidth,
  }))
  if (fit.content > fit.portrait) {
    throw new Error(
      `the start screen is ${fit.content}px wide in a ${fit.portrait}px window`,
    )
  }
  console.log(
    `  ok: no sideways overflow at 800x600 (${fit.content}px of ${fit.portrait}px)`,
  )
} finally {
  await browser.deleteSession()
}
