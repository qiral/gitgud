// The path above a commit's diff is readable at every width the window allows.
//
// A commit view splits its pane between the file list and the diff, and the
// bar over the diff ends in a group of icon buttons. At the app's own minimum
// window that left the path 12px of a 525px name (issue #140): the commit
// named nothing. This spec seeds the shape the report was written from (one
// long Turkish path in one real commit), sizes the window, and reads the path
// cell as the engine laid it out.
//
// The numbers are the report's gate, not a screenshot's opinion: the path gets
// at least 80px at 800x500 with the file list at its 160px minimum, and at
// least 120px at 1280x800. Every icon button is still there afterwards,
// because dropping a control to make room would take a setting away with it.
//
// Set LAB_SCREENS to a directory to keep a screenshot of the narrow state.
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { launch, openFixture, repo, text } from '../lab.mjs'

const git = (...args) =>
  execFileSync('git', ['-C', repo, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_DATE: '2024-01-04T09:00:00 +0000',
      GIT_COMMITTER_DATE: '2024-01-04T09:00:00 +0000',
    },
  }).trim()

/** A long path, so nothing can be blamed on a short name. */
const PATH =
  'src/ozellikler/kullanici-yonetimi/bilesenler/kullanici-oturum-acma-formu-bileseni.tsx'
const SUBJECT = 'add the long path component'

// The commit the report measured, made by the spec and read back by the app.
const file = `${repo}/${PATH}`
mkdirSync(dirname(file), { recursive: true })
writeFileSync(file, 'export const form = 1\nexport const dogrulama = 1\n')
git('add', '-A')
git('commit', '-qm', SUBJECT)

/** The header row's own boxes: the path cell and what shares the row. */
const HEADER = () => {
  const section = document.querySelector('section.isolate')
  const pathCell = section?.querySelector('div.truncate.select-text')
  const row = pathCell?.parentElement
  const fileList = [...(section?.querySelectorAll('div') ?? [])].find(
    (el) => el.style.width && el.querySelector('ul'),
  )
  return {
    sectionW: section ? Math.round(section.getBoundingClientRect().width) : 0,
    fileListW: fileList
      ? Math.round(fileList.getBoundingClientRect().width)
      : 0,
    rowW: row ? Math.round(row.getBoundingClientRect().width) : 0,
    pathCW: pathCell?.clientWidth ?? 0,
    pathSW: pathCell?.scrollWidth ?? 0,
    pathTitle: pathCell?.title ?? null,
    // A control that lost its width was hidden, not rearranged.
    controls: [...(row?.querySelectorAll('button') ?? [])].map((b) => ({
      title: b.title,
      w: Math.round(b.getBoundingClientRect().width),
    })),
  }
}

/** Clicks the first element matching `selector` whose text has `needle`. */
async function click(browser, selector, needle) {
  const ok = await browser.waitUntil(
    async () =>
      await browser.execute(
        (sel, want) => {
          const els = [...document.querySelectorAll(sel)]
          const el = els.find((e) => (e.innerText || '').includes(want))
          if (!el) return false
          el.click()
          return true
        },
        selector,
        needle,
      ),
    { timeout: 30000, timeoutMsg: `nothing to click: ${selector} ${needle}` },
  )
  if (!ok) throw new Error(`nothing to click: ${selector} ${needle}`)
  await browser.pause(500)
}

function gate(label, measured, floor) {
  if (!measured.pathCW) {
    throw new Error(`${label}: the diff header row is not on screen`)
  }
  console.log(
    `  ${label}: path ${measured.pathCW}px of ${measured.pathSW}px, ` +
      `file list ${measured.fileListW}px in a ${measured.sectionW}px pane`,
  )
  if (measured.pathCW < floor) {
    throw new Error(
      `${label}: the path is ${measured.pathCW}px wide with ` +
        `${measured.pathSW - measured.pathCW}px hidden, below the ${floor}px floor`,
    )
  }
}

const browser = await launch()
try {
  // Turkish text and a Turkish path are what the report was written in; the
  // locale is pinned so the tab this spec clicks is named the same every run.
  await browser.execute(() => localStorage.setItem('gitgud.locale', 'en'))
  await browser.setWindowSize(800, 500)
  await openFixture(browser)

  // A mousedown anywhere else closes whatever menu the previous screen left
  // open; the synthetic clicks below never send one, so the frame and the
  // measurements would otherwise carry a dropdown over them.
  await browser.execute(() =>
    document.body.dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true, cancelable: true }),
    ),
  )

  // Both clicks go through the element's own handler rather than a mouse
  // point: the tab and the first history row sit under an overlay for a
  // moment after the repository paints, and WebDriver refuses to click
  // through it. This is the same `click()` a pointer ends up calling.
  await click(browser, 'aside button', 'History')
  await click(browser, 'aside ul > li', SUBJECT)
  await browser.waitUntil(async () => (await text(browser)).includes(PATH), {
    timeout: 30000,
    timeoutMsg: "the commit's diff header never appeared",
  })

  // The app's own minimum window, the width in the report, with the file list
  // clamped to its 160px minimum.
  const narrow = await browser.execute(HEADER)
  gate('800x500', narrow, 80)
  if (narrow.pathTitle !== PATH) {
    throw new Error(`800x500: the path cell names ${narrow.pathTitle}`)
  }
  for (const control of narrow.controls) {
    if (control.w === 0) {
      throw new Error(
        `800x500: the ${control.title || 'unnamed'} control is gone`,
      )
    }
  }
  console.log(`  ok: all ${narrow.controls.length} header controls still there`)

  const screens = process.env.LAB_SCREENS
  if (screens) {
    mkdirSync(screens, { recursive: true })
    await browser.saveScreenshot(`${screens}/commit-path-800x500.png`)
    console.log(`  shot ${screens}/commit-path-800x500.png`)
  }

  // An ordinary desktop size, where the path was never the problem.
  await browser.setWindowSize(1280, 800)
  await browser.waitUntil(
    async () => (await browser.execute(HEADER)).sectionW > 600,
    { timeout: 30000, timeoutMsg: 'the pane never grew with the window' },
  )
  gate('1280x800', await browser.execute(HEADER), 120)
} finally {
  await browser.deleteSession()
}
