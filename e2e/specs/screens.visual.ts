import { test, expect } from '../fixtures/test'

// Advisory screenshots of the screens the functional specs also drive. A
// diff here means the pixels moved, which is worth a look but is not proof
// the app broke; see docs/TESTING.md.
test('the start screen looks the same', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'GitGud' })).toBeVisible()

  await expect(page).toHaveScreenshot('landing.png')
})

test('the clone dialog looks the same', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Clone repository' }).click()

  const form = page.locator('form')
  await form.getByRole('button', { name: 'URL' }).click()
  await form
    .getByPlaceholder('https://github.com/user/repo.git')
    .fill('https://github.com/qiral/gitgud.git')
  await expect(form.getByText('Will be cloned to')).toBeVisible()

  await expect(page).toHaveScreenshot('clone-dialog.png')
})
