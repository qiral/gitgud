import { test, expect } from '../fixtures/test'

test.use({ withRepo: true, signedIn: true })

// A branch pushed to a fork gets a pull request into the parent repository,
// and the toolbar then links to it.
test('a pull request is created from the toolbar', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: /Current branch/ }).click()
  await page.getByRole('button', { name: 'feature/login' }).first().click()

  const create = page.getByRole('button', { name: /Pull request\s*Create/ })
  await create.click()

  const dialog = page.getByRole('dialog', { name: 'Create pull request' })
  await expect(dialog.getByText('of qiral/demo')).toBeVisible()
  // One commit: its subject and body become the title and description.
  await expect(dialog.getByLabel('Title')).toHaveValue('Log in with a form')
  await expect(dialog.getByLabel('Description')).toHaveValue(
    'Uses the new session API.',
  )

  await dialog.getByLabel('Create as draft').check()
  await dialog.getByRole('button', { name: 'Create pull request' }).click()

  await expect(dialog).toBeHidden()
  await expect(
    page.getByRole('button', { name: /Pull request\s*#42 draft/ }),
  ).toBeVisible()
})
