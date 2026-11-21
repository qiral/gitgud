import { test, expect } from '../fixtures/test'

// The start screen with no repository open: the first thing anyone sees, and
// the cheapest screen to catch a broken build on.
test('the start screen offers a way in', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByRole('heading', { name: 'GitGud' })).toBeVisible()
  await expect(
    page.getByText('Open a Git repository to get started.'),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Open repository' }),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Clone repository' }),
  ).toBeVisible()

  // The version comes from the app plugin, so a line here also proves the
  // fake IPC answered.
  await expect(page.getByText('GitGud 0.0.0-e2e')).toBeVisible()
})
