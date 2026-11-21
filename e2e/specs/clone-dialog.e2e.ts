import { test, expect } from '../fixtures/test'

// The clone dialog is the busiest thing reachable from the start screen: two
// tabs, a folder that comes from the path plugin, and a form that only
// enables its button once it has everything it needs.
test('the clone dialog takes a repository url', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Clone repository' }).click()

  await expect(
    page.getByRole('heading', { name: 'Clone repository' }),
  ).toBeVisible()
  // Everything below is inside the dialog; the start screen behind it also
  // has a button with "Clone" in its name.
  const form = page.locator('form')

  // GitHub first, signed out: with no account there is nothing to list.
  await expect(
    form.getByRole('button', { name: 'GitHub', exact: true }),
  ).toBeVisible()
  await expect(
    form.getByText('Sign in to see your GitHub repositories.'),
  ).toBeVisible()

  await form.getByRole('button', { name: 'URL' }).click()
  await expect(form.getByText('Repository URL')).toBeVisible()

  await form
    .getByPlaceholder('https://github.com/user/repo.git')
    .fill('https://github.com/qiral/gitgud.git')

  // The folder comes from homeDir(), faked in the init script, and the
  // folder name follows the url.
  await expect(form.getByText('Will be cloned to')).toContainText(
    '/home/e2e/gitgud',
  )
  await expect(
    form.getByRole('button', { name: 'Clone', exact: true }),
  ).toBeEnabled()
})
