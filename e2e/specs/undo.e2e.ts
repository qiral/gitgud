import { test, expect } from '../fixtures/test'

test.use({ withRepo: true })

const mod = process.platform === 'darwin' ? 'Meta' : 'Control'

// A deleted branch is offered back right away.
test('deleting a branch can be undone', async ({ page }) => {
  await page.goto('/')
  const branch = page.getByRole('button', { name: /Current branch/ })
  await branch.click()
  await page
    .getByRole('button', { name: 'fix/typo' })
    .first()
    .click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Delete…' }).click()

  const toast = page.getByRole('status')
  await expect(toast).toContainText('Branch deleted')
  await toast.getByRole('button', { name: 'Undo' }).click()
  await expect(toast).toBeHidden()

  await page.keyboard.press(`${mod}+k`)
  await page.getByRole('combobox').fill('reflog')
  await page.keyboard.press('Enter')
  const dialog = page.getByRole('dialog', { name: 'Reflog' })
  await expect(dialog.getByText('Add b', { exact: true })).toBeVisible()
})
