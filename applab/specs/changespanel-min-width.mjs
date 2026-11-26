// The changes panel at the sidebar's own minimum width: the commit button and
// a section title keep their text.
//
// The sidebar's drag handle clamps to 220px (src/components/RepoView.tsx), so
// 220 is a width the app itself lets a user reach. There the commit button used
// to be 66px wide for a 127px label and the staged section's title 46px of 126,
// because the labels next to them are `shrink-0` and never give way (issue
// #141). The gate is geometric: a text box whose scrollWidth exceeds its
// clientWidth is painting an ellipsis, whatever the language.
//
// The label language is Turkish because that is the longest label the issue
// measured (`1 dosyayı commit et`), so the gate is the strictest case rather
// than the easiest one.
import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { launch, repo } from '../lab.mjs'

const OUT = process.env.LAB_SCREENS ?? '/tmp/gitgud-screens'

const git = (...args) =>
  execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim()

/** One staged file, so both the section title and the commit button say it. */
function stageAChange() {
  execFileSync('bash', [
    '-c',
    `printf 'export const kalan = 1\\n' > '${repo}/kalan.ts' && git -C '${repo}' add -A`,
  ])
  const status = git('status', '--short')
  if (!/^A\s+kalan\.ts$/m.test(status)) {
    throw new Error(`the fixture did not stage kalan.ts:\n${status}`)
  }
}

/**
 * The two boxes the issue names, measured in the real window: the primary
 * button carrying the commit label, and the title in the section header that
 * has a bulk action beside it.
 */
const MEASURE = () => {
  const aside = document.querySelector('aside')
  const commit = [...aside.querySelectorAll('button')].find((b) =>
    b.className.includes('bg-accent'),
  )
  const header = [...aside.querySelectorAll('section > div')].find((el) =>
    el.querySelector('button'),
  )
  const title = header?.querySelector('span')
  const row = commit?.parentElement
  return {
    aside: Math.round(aside.getBoundingClientRect().width),
    commit: commit
      ? {
          text: (commit.innerText || '').trim(),
          client: commit.clientWidth,
          scroll: commit.scrollWidth,
        }
      : null,
    // Every box in the commit row, in the order they are painted, so a failure
    // says which one took the room.
    row: row
      ? [...row.children].map((el) => ({
          text: (el.innerText || '').trim().slice(0, 20),
          width: Math.round(el.getBoundingClientRect().width),
          height: Math.round(el.getBoundingClientRect().height),
        }))
      : null,
    title: title
      ? {
          text: (title.innerText || '').trim(),
          client: title.clientWidth,
          scroll: title.scrollWidth,
        }
      : null,
  }
}

const browser = await launch()
try {
  stageAChange()
  mkdirSync(OUT, { recursive: true })

  const measured = {}
  for (const sidebar of [220, 320]) {
    // The app's own minimum window, and the sidebar width the handle allows
    // (or the default, for contrast). The stored width is what the handle
    // writes, so this is the same state a drag leaves behind.
    await browser.setWindowSize(800, 500)
    await browser.execute(
      (path, width) => {
        localStorage.setItem('gitgud.locale', 'tr')
        localStorage.setItem(
          'gitgud.recentRepos',
          JSON.stringify([{ path, name: 'fixture' }]),
        )
        localStorage.setItem('gitgud.width.sidebar', String(width))
      },
      repo,
      sidebar,
    )
    await browser.refresh()

    // The repository opens from the recents entry on load; wait for the panel
    // that carries the button rather than for a timeout.
    await browser.waitUntil(
      async () => {
        const m = await browser.execute(MEASURE)
        return m.aside > 0 && m.commit !== null && m.title !== null
      },
      { timeout: 30000, timeoutMsg: 'the changes panel never painted' },
    )
    await browser.pause(300)

    const m = await browser.execute(MEASURE)
    measured[sidebar] = m
    console.log(`  sidebar ${sidebar}: ${JSON.stringify(m)}`)

    if (m.aside !== sidebar) {
      throw new Error(
        `the sidebar is ${m.aside}px wide, not the ${sidebar}px asked for`,
      )
    }
    for (const [name, box] of [
      ['commit button', m.commit],
      ['staged title', m.title],
    ]) {
      if (box.scroll > box.client) {
        throw new Error(
          `at sidebar ${sidebar} the ${name} is cut: ${JSON.stringify(box)}`,
        )
      }
    }
    if (sidebar === 220) {
      await browser.saveScreenshot(`${OUT}/changes-sidebar220-fixed.png`)
      console.log(`  shot ${OUT}/changes-sidebar220-fixed.png`)
    }
  }

  // The fix must not change the default: at 320 the commit row is still one
  // line, with the button at its full width.
  const wide = measured[320]
  if (wide.commit.client < 160) {
    throw new Error(
      `at sidebar 320 the commit button shrank to ${wide.commit.client}px`,
    )
  }
  const wideHeights = new Set(wide.row.map((el) => el.height))
  if (wideHeights.size !== 1) {
    throw new Error(
      `at sidebar 320 the commit row wrapped: ${JSON.stringify(wide.row)}`,
    )
  }
  console.log(
    `  ok: both labels whole at 220 and 320, one-row commit button ${wide.commit.client}px at 320`,
  )
} finally {
  await browser.deleteSession()
}
