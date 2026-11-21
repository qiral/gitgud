import { defineConfig } from '@playwright/test'
// @ts-expect-error type error without @types/node package
import process from 'node:process'

// The web UI runs on its own: vite serves it on the port tauri.conf.json
// points its devUrl at, so none of this needs the Rust shell or a built app.
//
// Two projects, two jobs to be done:
// - functional: DOM assertions plus the console/pageerror fixture. A failure
//   here is a broken app and fails the build.
// - visual: the same screens as screenshots against committed baselines.
//   Advisory in CI: a diff is reported, not fatal. Baselines are only ever
//   written on Linux Chromium, the environment the pinned Playwright
//   container gives both CI and the person refreshing them.
export default defineConfig({
  testDir: './e2e/specs',
  outputDir: './e2e/test-results',
  forbidOnly: !!process.env.CI,
  // A retry would hide the flake it is meant to reveal.
  retries: 0,
  // Screenshots are pixel comparisons, so nothing else may run next to them.
  workers: 1,
  reporter: process.env.CI
    ? [
        ['github'],
        ['html', { open: 'never', outputFolder: './e2e/playwright-report' }],
        // The visual step's diff count lands in the job summary; see
        // .github/workflows/ci.yml.
        ['json', { outputFile: './e2e/test-results/results.json' }],
      ]
    : [
        ['list'],
        ['html', { open: 'never', outputFolder: './e2e/playwright-report' }],
      ],

  use: {
    baseURL: 'http://localhost:1420',
    // Close to the 1200x780 window tauri.conf.json opens, and fixed so a
    // screenshot does not depend on the screen of whoever runs it.
    viewport: { width: 1200, height: 780 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  expect: {
    toHaveScreenshot: {
      animations: 'disabled',
      caret: 'hide',
    },
  },

  // An expected baseline that is missing fails instead of being written
  // silently, so a new screen shows up as a red run and not as a gap.
  updateSnapshots: 'default',

  // One browser, one platform: the baseline's file name says both, so a
  // screenshot from another environment never gets compared against it.
  snapshotPathTemplate:
    '{testDir}/{testFilePath}-snapshots/{arg}-chromium-{platform}{ext}',

  projects: [
    {
      name: 'functional',
      testMatch: '**/*.e2e.ts',
      use: { browserName: 'chromium' },
    },
    {
      name: 'visual',
      testMatch: '**/*.visual.ts',
      use: { browserName: 'chromium' },
    },
  ],

  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:1420',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
