// The two things every e2e spec needs: a page that believes it runs inside
// Tauri, and a spec that fails when the page logged or threw something.
//
// The fake IPC mirrors src/test/setup.ts, where vitest uses
// @tauri-apps/api/mocks for the same job. A real browser can't import that
// module before the app boots, so the fake is written out by hand and
// installed with addInitScript, which runs before any app script on every
// navigation.
import { test as base, expect } from '@playwright/test'

/**
 * Commands the start screen and the clone dialog reach for, with the data a
 * healthy Rust side would hand back. With `withRepo`, the app opens a small
 * fake repository at start instead, as if passed on the command line. A command that is missing here throws,
 * so adding one to the frontend without a fixture fails the spec instead of
 * rendering half a screen.
 *
 * This function is serialized into the page: it must not use anything from
 * the module scope.
 */
function installTauriMock(withRepo: boolean) {
  const home = '/home/e2e'
  const repo = { path: `${home}/demo`, name: 'demo' }
  // The repository's state, changed by the commands that change it.
  let current = 'main'
  const branchNames = ['main', 'feature/login', 'fix/typo']

  const callbacks = new Map<number, (data: unknown) => void>()
  let nextId = 1

  const repoCommands: Record<
    string,
    (args: Record<string, unknown>) => unknown
  > = {
    initial_repo: () => repo.path,
    open_repo: () => repo,
    status: () => ({
      branch: current,
      upstream: `origin/${current}`,
      ahead: 0,
      behind: 0,
      files: [],
      merging: null,
      operation: null,
      rebasing: null,
    }),
    branches: () =>
      branchNames.map((name) => ({
        name,
        current: name === current,
        upstream: `origin/${name}`,
      })),
    log: () => [],
    origin_url: () => 'https://github.com/e2e/demo.git',
    stashes: () => [],
    switch_branch: (args) => {
      current = String(args.name)
      return null
    },
  }

  const commands: Record<string, (args: Record<string, unknown>) => unknown> = {
    // src/lib/git.ts
    initial_repo: () => null,
    github_account: () => null,
    // src/lib/updates.tsx: this app's version and "is there a release"
    'plugin:app|version': () => '0.0.0-e2e',
    'plugin:updater|check': () => null,
    // @tauri-apps/api/path, for the clone dialog's default folder
    'plugin:path|resolve_directory': () => home,
    // src/lib/prefs.ts paints the native title bar; nothing to paint here
    'plugin:window|set_theme': () => null,
    // @tauri-apps/plugin-dialog: no native file picker in a browser
    'plugin:dialog|open': () => null,
    'plugin:dialog|message': () => 'Ok',
    ...(withRepo ? repoCommands : {}),
  }

  function transformCallback(callback: (data: unknown) => void, once = false) {
    const id = nextId++
    callbacks.set(id, (data) => {
      if (once) callbacks.delete(id)
      callback(data)
    })
    return id
  }

  function unregisterCallback(id: number) {
    callbacks.delete(id)
  }

  function runCallback(id: number, data: unknown) {
    callbacks.get(id)?.(data)
  }

  // The event plugin's own commands. `listen` hands back the callback id it
  // was given, `unlisten` drops it, and nothing is ever emitted: the UI only
  // needs a channel that opens and closes without complaining.
  function invoke(cmd: string, args: Record<string, unknown> = {}) {
    if (cmd === 'plugin:event|listen') return Promise.resolve(args.handler)
    if (cmd === 'plugin:event|unlisten') {
      unregisterCallback(Number(args.eventId))
      return Promise.resolve(null)
    }

    const command = commands[cmd]
    if (!command) {
      return Promise.reject(new Error(`no e2e fixture for the ${cmd} command`))
    }
    return Promise.resolve(command(args))
  }

  const scope = window as Window & {
    isTauri?: boolean
    __TAURI_INTERNALS__?: Record<string, unknown>
    __TAURI_EVENT_PLUGIN_INTERNALS__?: Record<string, unknown>
  }

  scope.isTauri = true
  scope.__TAURI_INTERNALS__ = {
    invoke,
    transformCallback,
    unregisterCallback,
    runCallback,
    metadata: {
      currentWindow: { label: 'main' },
      currentWebview: { windowLabel: 'main', label: 'main' },
    },
  }
  scope.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
    unregisterListener: (_event: string, id: number) => unregisterCallback(id),
  }
}

export const test = base.extend<{
  withRepo: boolean
  tauri: void
  errors: string[]
}>({
  // `test.use({ withRepo: true })` starts the app inside a fake repository.
  withRepo: [false, { option: true }],

  tauri: [
    async ({ page, withRepo }, use) => {
      await page.addInitScript(installTauriMock, withRepo)
      await use()
    },
    { auto: true },
  ],

  errors: [
    async ({ page }, use) => {
      // Nothing is filtered out: a 404 for a missing favicon is not a console
      // error, so anything that lands here was the app's own doing.
      const errors: string[] = []
      page.on('console', (message) => {
        if (message.type() === 'error')
          errors.push(`console: ${message.text()}`)
      })
      page.on('pageerror', (error) => {
        errors.push(`pageerror: ${error.message}`)
      })

      await use(errors)

      // A silent TypeError or a rejected invoke is exactly what the unit
      // tests can't see, so any of them fails the spec.
      expect(errors, `the page logged errors:\n${errors.join('\n')}`).toEqual(
        [],
      )
    },
    { auto: true },
  ],
})

export { expect }
