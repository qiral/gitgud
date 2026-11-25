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
function installTauriMock({
  withRepo,
  signedIn,
  withChanges,
}: {
  withRepo: boolean
  withChanges: boolean
  signedIn: boolean
}) {
  const home = '/home/e2e'
  const repo = { path: `${home}/demo`, name: 'demo' }
  // The repository's state, changed by the commands that change it.
  let current = 'main'
  let remotes: { name: string; url: string; pushUrl: string | null }[] = [
    {
      name: 'origin',
      url: 'https://github.com/e2e/demo.git',
      pushUrl: null,
    },
  ]
  const commit = {
    hash: 'abc1234'.padEnd(40, '0'),
    shortHash: 'abc1234',
    author: 'Grace',
    email: 'grace@example.com',
    time: 1700000000,
    subject: 'Add b',
    parents: ['def5678'.padEnd(40, '0')],
    refs: [],
    graph: { lane: 0, color: 0, width: 1, segments: [] },
  }
  let dirty = withChanges
  const submodules = withRepo
    ? [
        {
          path: 'libs/zlib',
          recorded: 'fedcba9'.padEnd(40, '0'),
          checkedOut: null as string | null,
          state: 'missing',
        },
      ]
    : []
  const worktrees = [
    {
      path: repo.path,
      branch: 'main',
      head: commit.hash,
      main: true,
      current: true,
      locked: false,
      missing: false,
    },
  ]
  let undoable: { id: number; kind: string } | null = null
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
      files: dirty
        ? [
            {
              path: 'src/app.ts',
              index: '.',
              worktree: 'M',
              untracked: false,
              conflicted: false,
            },
          ]
        : [],
      merging: null,
      operation: null,
      rebasing: null,
    }),
    branches: () =>
      branchNames.map((name) => ({
        name,
        current: name === current,
        upstream: `origin/${name}`,
        worktree:
          worktrees.find((w) => !w.current && w.branch === name)?.path ?? null,
      })),
    log: () => [commit],
    show_commit: () =>
      [
        commit.subject,
        '',
        'diff --git a/src/app.ts b/src/app.ts',
        '--- a/src/app.ts',
        '+++ b/src/app.ts',
        '@@ -1 +1,2 @@',
        ' const a = 1',
        '+const b = 2',
        '',
      ].join('\n'),
    compare: (args) => ({
      baseHash: commit.parents[0],
      headHash: commit.hash,
      fromHash: commit.parents[0],
      related: true,
      ahead: [commit],
      aheadCount: 1,
      behind: [],
      behindCount: 0,
      diff: args.direct
        ? ''
        : [
            'diff --git a/src/login.ts b/src/login.ts',
            '--- a/src/login.ts',
            '+++ b/src/login.ts',
            '@@ -1,3 +1,4 @@',
            ' // Signs in.',
            "-const user = load('me')",
            "+const user = load('you', 2)",
            '+export function login() {}',
            ' return user',
            '',
          ].join('\n'),
    }),
    blame: (args) =>
      args.rev === commit.hash
        ? {
            origins: [
              {
                hash: commit.parents[0],
                author: 'Ada',
                time: 1600000000,
                subject: 'Start',
                path: 'src/app.ts',
                previous: null,
              },
              {
                hash: commit.hash,
                author: commit.author,
                time: commit.time,
                subject: commit.subject,
                path: 'src/app.ts',
                previous: { hash: commit.parents[0], path: 'src/app.ts' },
              },
            ],
            lines: [
              { origin: 0, original: 1, text: 'const a = 1' },
              { origin: 1, original: 2, text: 'const b = 2' },
            ],
          }
        : { origins: [], lines: [] },
    remotes: () => remotes,
    remote_branches: () => remotes.map((r) => `${r.name}/main`),
    add_remote: (args) => {
      remotes.push({
        name: String(args.name),
        url: String(args.url),
        pushUrl: null,
      })
      return null
    },
    remove_remote: (args) => {
      remotes = remotes.filter((r) => r.name !== args.name)
      return null
    },
    fetch: () => null,
    undo_available: () => undoable,
    delete_branch: () => {
      undoable = { id: 1, kind: 'deleteBranch' }
      return { notMerged: false }
    },
    undo_last: () => {
      undoable = null
      return null
    },
    reflog: () => [
      {
        hash: commit.hash,
        shortHash: commit.shortHash,
        time: commit.time,
        action: 'commit: Add b',
        subject: commit.subject,
      },
    ],
    signatures: () => ({}),
    file_text: () => null,
    submodules: () => submodules,
    update_submodules: () => {
      for (const s of submodules) {
        s.checkedOut = s.recorded
        s.state = 'current'
      }
      return null
    },
    worktrees: () => worktrees,
    add_worktree: (args) => {
      worktrees.push({
        ...worktrees[0],
        path: String(args.path),
        branch: String(args.branch),
        main: false,
        current: false,
      })
      return args.path
    },
    diff: () => '',
    discard: () => {
      dirty = false
      return null
    },
    stashes: () => [],
    switch_branch: (args) => {
      current = String(args.name)
      return null
    },
  }

  // A signed-in GitHub account whose branch was pushed to a fork.
  let pull: Record<string, unknown> | null = null
  const openPulls = [
    {
      number: 7,
      title: 'Remember me',
      url: 'https://github.com/qiral/demo/pull/7',
      draft: false,
      author: 'ada',
      head: 'ada:remember-me',
      base: 'main',
      updatedAt: '2026-01-01T00:00:00Z',
      checks: 'passed',
      review: 'approved',
    },
  ]
  const githubCommands: Record<
    string,
    (args: Record<string, unknown>) => unknown
  > = {
    github_account: () => ({
      login: 'e2e',
      name: 'E2E',
      // A blank pixel: nothing is fetched from the network.
      avatarUrl:
        'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==',
    }),
    github_pull_target: () => ({
      baseRepo: 'qiral/demo',
      headRepo: 'e2e/demo',
      branch: current,
      defaultBase: 'main',
      existing: pull,
    }),
    github_parent: () =>
      remotes.some((r) => r.url.includes('qiral/'))
        ? null
        : { fullName: 'qiral/demo', url: 'https://github.com/qiral/demo.git' },
    github_branches: () => ['main', 'dev'],
    github_compare: () => ({
      mergeBase: 'abc1234',
      commits: ['Log in with a form\n\nUses the new session API.'],
    }),
    github_create_pull_request: (args) => {
      pull = {
        number: 42,
        title: args.title,
        state: 'open',
        draft: args.draft,
        url: 'https://github.com/qiral/demo/pull/42',
      }
      return pull
    },
    github_pull: (args) => ({ ...openPulls[0], number: args.number }),
    github_pulls: () => ({
      repo: 'qiral/demo',
      pulls: openPulls,
      total: openPulls.length,
    }),
    github_checkout_pull: (args) => {
      current = `pr/${args.number}`
      branchNames.push(current)
      return current
    },
    open_url: () => null,
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
    // Confirms: the answer is the label of the button, when it has its own.
    'plugin:dialog|message': (args) => {
      const buttons = args.buttons as { OkCancelCustom?: string[] } | string
      return (
        (typeof buttons === 'object' && buttons?.OkCancelCustom?.[0]) || 'Ok'
      )
    },
    ...(withRepo ? repoCommands : {}),
    ...(signedIn ? githubCommands : {}),
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
  signedIn: boolean
  withChanges: boolean
  tauri: void
  errors: string[]
}>({
  // `test.use({ withRepo: true })` starts the app inside a fake repository.
  withRepo: [false, { option: true }],
  // `test.use({ signedIn: true })` adds a GitHub account and pull requests.
  signedIn: [false, { option: true }],
  // `test.use({ withChanges: true })` has an uncommitted change in it.
  withChanges: [false, { option: true }],

  tauri: [
    async ({ page, withRepo, signedIn, withChanges }, use) => {
      await page.addInitScript(installTauriMock, {
        withRepo,
        signedIn,
        withChanges,
      })
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
