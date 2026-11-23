import { test, expect } from '../fixtures/test'

test.use({ withRepo: true })

test('a clean repository opens on History', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText('Add b')).toBeVisible()

  // Changes still opens by hand, and stays when the window is focused.
  await page.getByRole('button', { name: /^Changes/ }).click()
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(page.getByText('No local changes')).toBeVisible()

  // A typed message is still there after looking at History.
  const message = page.getByPlaceholder('Commit message')
  await message.fill('half typed')
  await page.getByRole('button', { name: /^History/ }).click()
  await expect(message).toBeHidden()
  await page.getByRole('button', { name: /^Changes/ }).click()
  await expect(message).toHaveValue('half typed')
})

test.describe('with changes', () => {
  test.use({ withChanges: true })

  test('Changes opens, until nothing is left in it', async ({ page }) => {
    await page.goto('/')
    const file = page.getByTitle('src/app.ts')
    await expect(file).toBeVisible()

    await file.hover()
    await page.getByTitle('Discard changes', { exact: true }).click()
    await expect(page.getByText('Add b')).toBeVisible()
  })
})
