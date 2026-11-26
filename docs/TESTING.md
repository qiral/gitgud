# Testing

Three layers, each catching what the one above it can't. A fourth one drives the
real app and is run by hand; see [The app lab](#the-app-lab).

| Layer | Command | What it proves |
| --- | --- | --- |
| Unit and component tests (vitest, jsdom) | `npm test` | Components render and behave with mocked IPC; the git parsers, paths and time helpers are correct |
| e2e functional (Playwright) | `npm run test:e2e` | The real page in a real browser: the start screen and the clone dialog render, respond and log nothing |
| e2e visual (Playwright) | `npm run test:visual` | The pixels of those screens, compared against committed baselines |
| app lab (WebDriver, local only) | `npm run test:app` | The real window over the real IPC: a repository opens and a branch gets made, checked on disk |

The Rust side has its own tests; see the CI workflow.

## The parity lab

The backend is a parser over git's output, and its unit tests check that parse
against output someone read once and wrote down. `src-tauri/tests/parity.rs`
asks the other question: it builds a scratch repository (a temp dir, `git init`,
a fixed identity, three fixed commits), drives the state through the backend's
own functions, reads the same state a second time straight from the `git` CLI,
and compares the two independent reads.

What it compares are facts, not text: the (path, status) pairs that are staged
or unstaged; the names that are untracked or in conflict; the commit hash,
parents and subject of every entry in the history, and the counts. Rename
sources are parsed by the backend but not compared in this slice: nothing
seeded renames yet, and a rename slice has to carry the old paths on both
sides first. Porcelain output gets reflowed
between git releases and that must not paint the lab red; a parse that drifts
from git must. It runs the real binary on purpose, so there is nothing mocked
here to agree with the backend by construction.

Every test in the file is `#[ignore]`d, so `cargo test` skips it. Run it by
hand:

```bash
cargo test --manifest-path src-tauri/Cargo.toml --test parity -- --ignored
```

`.github/workflows/parity.yml` runs exactly that on three triggers: a manual
`workflow_dispatch`, a push to any `parity/**` branch, and a nightly tour of
`main` at 04:17 UTC. It is Rust only: no node, no npm, no built frontend.

It stays out of the per-push gates because it is meant to grow: stash states,
merge conflicts, rebase stops, the odd ref shape. That is worth running before
a release and after touching `git.rs`, and it is not worth paying for on every
push, so it is invoked rather than ambient.

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

Two options widen the table for specs that need more than the start screen:
`test.use({ withRepo: true })` opens a small fake repository at start (three
branches, switching between them works), and `test.use({ signedIn: true })`
adds a GitHub account whose branch was pushed to a fork, with the pull request
commands. See `e2e/specs/command-palette.e2e.ts` and
`e2e/specs/pull-request.e2e.ts`.

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

## The app lab

Everything above drives the web UI. The app lab drives the app: a real
window, the real IPC, the real Rust commands, real `git` on a real repository.
It is a local tool, not a gate, and it lives in `applab/`.

```bash
npm run test:app                  # the debug binary as it was built
npm run test:app -- --rebuild     # build it first, then run
npm run test:app -- --only open   # one spec, by file name
```

Every spec talks to the window through WebDriver: `tauri-driver` in front,
`WebKitWebDriver` behind it, both started and stopped by `applab/run.sh`. The
script checks its prerequisites and says which package is missing, starts its
own `Xvfb` on the first free display, points the app's data, cache and config
directories at a temp dir so the run always begins on the start screen, makes
a fixture repository, runs the specs, and tears all of it down through a trap.
A failed run leaves no window, no driver and no X server behind. On Wayland it
unsets `WAYLAND_DISPLAY`, because a window that lands on your own desktop is a
bug in the lab.

The specs are plain `node` scripts, not a runner's files: nothing named
`*.e2e.ts` or `*.test.ts`, so neither Playwright nor vitest collects any of
it, and `npm run build` does not type check it either. Four of them, four
slices:

- **smoke.** The window opens with the debug binary, the title is `GitGud`, the
  start screen shows its two buttons, the page has a real Tauri bridge, and at
  the app's minimum window of 800x500 the screen does not run off the side.
- **open.** Opens the fixture through the recents list, then reads the
  repository off the screen: every commit subject `git log` reports, every
  branch `git branch` reports. This is the first test here that crosses the
  click, the IPC, Rust and `git` in one line.
- **branch.** Types a new branch name into the branch menu, presses Enter, and
  then asks `git` in the fixture: HEAD is the new branch, and it points at
  main's tip. What the app says is not the assertion; the disk is.
- **branch-shadow.** Tags the fixture's `feature/login` with the same name
  first, then reads the menu back: the branch is listed under its own name,
  and clicking the row moves HEAD onto it. A short ref name resolves against
  every ref, so this is the shape that used to hide the branch.

The fixture is `applab/fixtures/make-repo.sh`: three commits with fixed dates
and a fixed identity, a `feature/login` branch, and a rename in the last commit.
No network, no clock, the same history on every machine.

The start screen's own Open repository button opens a native GTK picker, which
WebDriver cannot see into. So the lab seeds one recents entry in the WebView's
`localStorage` and clicks that row; the click calls the same `open_repo` command
the picker calls, so the chain under test is unchanged.

### Prerequisites

| | |
| --- | --- |
| Arch Linux | `sudo pacman -S webkitgtk-6.0 xorg-server-xvfb` |
| Debian, Ubuntu | `sudo apt install webkit2gtk-driver xvfb` |
| anywhere | `cargo install tauri-driver --locked` |

Plus `git`, `node` and a debug build. `applab/run.sh` names whichever of these
is missing, and refuses to start without it.

If this machine needs something extra to build the debug app (a non-standard
OpenSSL prefix, say), put the whole command in `LAB_BUILD_CMD`:

```bash
LAB_BUILD_CMD='PKG_CONFIG_PATH=/opt/openssl/lib/pkgconfig npm run tauri build -- --debug --no-bundle' \
  npm run test:app -- --rebuild
```

### What it does not cover

The desktop shell is now reachable, but not entirely. The native file picker,
the updater, the OS menus and window chrome are all still outside it: WebDriver
drives the webview, not the window around it. Drag and drop is off in this app
(`dragDropEnabled: false`) and so is untested here. macOS is out too, because the
Tauri WebDriver has no macOS driver. And the lab is X11 on Linux, one window per
session.

It is also one machine's worth of trust, not a portable gate: spawning the debug
app once per spec costs a few seconds each, and what is green here is green on
Linux WebKitGTK on this box, not on someone else's.

### Why it is not in CI

Because it is exactly the thing the watchlist note above says it is: pre-alpha,
a browser engine driven through two intermediaries, and a display server that a
runner has to fake. Nothing in `.github/workflows/` runs it, and nothing should
until it has run locally for a while without surprising anyone. The watchlist
decision has not changed: the app lab is a local tool for bug hunting, and the
units, the mocked e2e specs and the parity lab stay the gates.

## What this does not cover

- **The mock is a map, not the territory.** The specs prove the UI layer
  renders and reacts; they don't run git, Rust or the real IPC. A spec can pass
  while the app is broken, so when a change touches `src-tauri/`, read it and
  test it there (`cargo test`), or send the app lab through it.
- **The desktop shell is not covered.** Window chrome, menus, drag and drop,
  the native file picker and the updater are out of reach for a browser. The
  official route for that is WebDriver (`tauri-driver`), which is still
  pre-alpha, needs `webkit2gtk-driver` and `xvfb` in CI, and doesn't support
  macOS. It stays on the watchlist rather than in this repo. The app lab above
  uses it locally, which is the one place it has been made to fit.
- **Chromium is not WebKitGTK.** Tauri uses WebKit on Linux and macOS, so the
  tests above exercise the same React code in a different engine. Fine for
  layout and logic, not proof of identical rendering in the app window. The app
  lab runs the same WebKitGTK the app ships on Linux, one engine in one window.
- **Only the start screen and the clone dialog have baselines.** The repo view
  needs a repository and much more fixture data; it has unit tests, not
  screenshots.
- **The e2e files sit outside the build's type check.** `npm run build` checks
  `src/`; Playwright loads `e2e/**` and `playwright.config.ts` as they are, so
  a type slip there shows up when the specs run, not in the build gate.
