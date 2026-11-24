import { test, expect } from '../fixtures/test'

test.use({ withRepo: true })

// A branch is compared with the current one before merging it.
test('a branch is compared with the current one', async ({ page }) => {
  await page.goto('/')
  const branch = page.getByRole('button', { name: /Current branch/ })
  await expect(branch).toContainText('main')
  await branch.click()
  await page.getByText('feature/login').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Compare with main' }).click()

  const base = page.getByLabel('Compare against')
  const head = page.getByLabel('Compare', { exact: true })
  await expect(base).toHaveValue('refs/heads/main')
  await expect(head).toHaveValue('refs/heads/feature/login')
  await expect(page.getByText('login.ts').first()).toBeVisible()
  // The diff is syntax highlighted once the language has loaded.
  await expect(page.locator('td .text-syn-keyword').first()).toHaveText('const')

  await page.getByRole('button', { name: 'Swap sides' }).click()
  await expect(base).toHaveValue('refs/heads/feature/login')

  await page.getByRole('checkbox', { name: 'Direct' }).check()
  await expect(page.getByText('Nothing differs.')).toBeVisible()

  await page.getByRole('button', { name: '1 commit ahead' }).click()
  await page.getByRole('button', { name: /Add b/ }).click()
  // The commit itself, in History.
  await expect(base).toBeHidden()
  await expect(page.getByText('1 changed file')).toBeVisible()
})

test('a comparison starts from the keyboard', async ({ page }) => {
  await page.goto('/')
  await expect(
    page.getByRole('button', { name: /Current branch/ }),
  ).toContainText('main')
  await page.keyboard.press('ControlOrMeta+Shift+d')
  await page.getByRole('combobox').fill('typo')
  await page.keyboard.press('Enter')
  await expect(page.getByLabel('Compare', { exact: true })).toHaveValue(
    'refs/heads/fix/typo',
  )
  await page.getByRole('button', { name: 'Close comparison' }).click()
  await expect(page.getByLabel('Compare', { exact: true })).toBeHidden()
})
