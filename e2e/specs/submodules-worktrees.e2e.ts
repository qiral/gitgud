import { test, expect } from '../fixtures/test'

test.use({ withRepo: true, withChanges: true })

test('a missing submodule is downloaded', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText('Submodules (1)')).toBeVisible()
  await expect(page.getByText('not downloaded')).toBeVisible()
  await page.getByRole('button', { name: 'Update libs/zlib' }).click()
  await expect(page.getByText('fedcba9')).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Open libs/zlib' }),
  ).toBeVisible()
})

test('a worktree is added and its branch shows where it is', async ({
  page,
}) => {
  await page.goto('/')
  await page.getByRole('button', { name: /Repository\s*demo/ }).click()
  await page.getByRole('button', { name: 'Worktrees…' }).click()
  const dialog = page.getByRole('dialog', { name: 'Worktrees' })
  await dialog.getByLabel('Branch').selectOption('feature/login')
  await expect(dialog.getByLabel('Folder')).toHaveValue(
    '/home/e2e/demo-feature-login',
  )
  await dialog.getByRole('button', { name: 'Add worktree' }).click()
  await expect(dialog.getByText('/home/e2e/demo-feature-login')).toBeVisible()
  await page.keyboard.press('Escape')

  await page.getByRole('button', { name: /Current branch/ }).click()
  await expect(
    page.getByTitle('Checked out in /home/e2e/demo-feature-login'),
  ).toBeVisible()
})
