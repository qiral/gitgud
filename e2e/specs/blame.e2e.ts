import { test, expect } from '../fixtures/test'

test.use({ withRepo: true })

// A file is blamed at a commit, and its lines link back to History.
test('a file is blamed from a commit', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: /^History/ }).click()
  await page.getByText('Add b').click()
  await page.getByText('app.ts').first().click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Blame' }).click()

  await expect(page.getByText('const b = 2')).toBeVisible()
  await expect(page.getByText('Not committed yet')).toBeHidden()

  await page.getByRole('button', { name: /abc1234 Grace/ }).click()
  // Back on the commit, with its file list.
  await expect(page.getByTitle('Close blame')).toBeHidden()
  await expect(page.getByText('1 changed file')).toBeVisible()
})
