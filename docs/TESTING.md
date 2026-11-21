# Testing

Three layers, each catching what the one above it can't.

| Layer | Command | What it proves |
| --- | --- | --- |
| Unit and component tests (vitest, jsdom) | `npm test` | Components render and behave with mocked IPC; the git parsers, paths and time helpers are correct |
| e2e functional (Playwright) | `npm run test:e2e` | The real page in a real browser: the start screen and the clone dialog render, respond and log nothing |
| e2e visual (Playwright) | `npm run test:visual` | The pixels of those screens, compared against committed baselines |

The Rust side has its own tests; see the CI workflow.

## How the browser tests run

The web UI is driven without the Tauri shell. Vite already serves it on a fixed
port (1420, the same `devUrl` `src-tauri/tauri.conf.json` points at), so
Playwright starts `npm run dev` itself, opens it in Chromium, and talks to it
like any other web page. No Rust toolchain, no built app, no `tauri dev`.

The app is not a plain website though: it calls `invoke()` and listens for
events. So an init script runs before any app code and installs a fake Tauri on
the page: `window.isTauri`, `window.__TAURI_INTERNALS__` (with `invoke`,
`transformCallback`, `unregisterCallback`, `runCallback`, `metadata`) and the event plugin's
`unregisterListener`. The fake `invoke` answers from a small table of benign
fixtures: no repository opened, no GitHub account, the home directory, and
updater and window calls that do nothing. A command that isn't in the table
rejects, so a new `invoke` on the start screen fails a spec instead of rendering
half a screen.

This mirrors `src/test/setup.ts`, where vitest does the same job with
`@tauri-apps/api/mocks`. That module can't be used here because it has to be
imported before the app boots, which an init script can't do, so the fake is
written out by hand in `e2e/fixtures/test.ts`.

The same file carries the other fixture: every spec is failed if the page
logged a console error or threw a `pageerror`, with nothing filtered out. That
is what catches a `TypeError` or a rejected `invoke` that no assertion
mentioned.

## Adding a spec

- A functional spec is `e2e/specs/<name>.e2e.ts` and runs under
  `npm run test:e2e`. Add one for a new screen: assert what the screen shows
  and that the console stays quiet. If the screen calls a command the fixture
  doesn't know, add it to the table.
- A screenshot is `e2e/specs/<name>.visual.ts` and runs under
  `npm run test:visual`. Add a baseline only for a screen worth watching, not
  for every change.
- The names matter: vitest collects `*.test.ts`, so `*.spec.ts` would be picked
  up by the wrong runner.

## Visual diffs are advisory

A visual diff does not fail CI. The job runs the visual specs with
`continue-on-error`, uploads the report and the diff images either way, and
writes one line with the diff count into the job summary. The gate is held by
the console/pageerror fixture and the DOM assertions, not by the pixels.

That is on purpose: a font substitution or a one pixel shift on a runner image
is not a bug in the app, and a red build for it teaches people to retry.
A diff is a question, not a verdict.

To look at a diff, download the `playwright-report` artifact from the run and
open `visual/index.html`. A deliberate look change is refreshed on purpose:

```bash
npm run test:visual:update
```

which rewrites the baselines in `e2e/specs/screens.visual.ts-snapshots/`. Commit
the new PNGs with the change, so the pull request shows the before and after as
pixel diffs and a reviewer can see what moved.

## The pinned environment

Baselines are Chromium on Linux with the fonts and rendering of one exact
environment: the Playwright container image, `mcr.microsoft.com/playwright`,
version matching `@playwright/test` in `package.json`. CI runs the specs inside
that image, and baselines are generated inside it too:

```bash
docker run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp \
  -v "$PWD":/work -w /work \
  mcr.microsoft.com/playwright:v1.65.1-noble \
  bash -c 'npm run test:visual:update'
```

A plain `npm run test:e2e` on your machine is fine once Chromium is installed
(`npx playwright install chromium` does that once and keeps it next to the
other browsers), but a visual run outside the container may compare fonts the
baseline never saw, and will fail on pixels nobody changed. When that happens,
run it in the container before believing the diff. Keep the image tag, the
`@playwright/test` version in `package.json` and the tag in
`.github/workflows/ci.yml` in step with each other.

## What this does not cover

- **The mock is a map, not the territory.** The specs prove the UI layer
  renders and reacts; they don't run git, Rust or the real IPC. A spec can pass
  while the app is broken, so when a change touches `src-tauri/`, read it and
  test it there (`cargo test`).
- **The desktop shell is not covered.** Window chrome, menus, drag and drop,
  the native file picker and the updater are out of reach for a browser. The
  official route for that is WebDriver (`tauri-driver`), which is still
  pre-alpha, needs `webkit2gtk-driver` and `xvfb` in CI, and doesn't support
  macOS. It stays on the watchlist rather than in this repo.
- **Chromium is not WebKitGTK.** Tauri uses WebKit on Linux and macOS, so the
  tests exercise the same React code in a different engine. Fine for layout and
  logic, not proof of identical rendering in the app window.
- **Only the start screen and the clone dialog have baselines.** The repo view
  needs a repository and much more fixture data; it has unit tests, not
  screenshots.
- **The e2e files sit outside the build's type check.** `npm run build` checks
  `src/`; Playwright loads `e2e/**` and `playwright.config.ts` as they are, so
  a type slip there shows up when the specs run, not in the build gate.
