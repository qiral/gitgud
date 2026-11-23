import { test, expect } from '../fixtures/test'

test.use({ withRepo: true, signedIn: true })

const mod = process.platform === 'darwin' ? 'Meta' : 'Control'

// A fork gets its parent as a second remote, whose branches can be merged.
test('a fork is set up with its upstream', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: /^Repository/ }).click()
  await page.getByRole('button', { name: 'Manage remotes…' }).click()

  const dialog = page.getByRole('dialog', { name: 'Remotes' })
  await expect(
    dialog.getByText('https://github.com/e2e/demo.git'),
  ).toBeVisible()
  await dialog.getByRole('button', { name: /Add qiral\/demo/ }).click()

  await expect(
    dialog.getByText('https://github.com/qiral/demo.git'),
  ).toBeVisible()
  await expect(
    dialog.getByRole('button', { name: /Add qiral\/demo/ }),
  ).toBeHidden()
  await page.keyboard.press('Escape')

  await page.keyboard.press(`${mod}+Shift+M`)
  await expect(
    page.getByRole('option', { name: 'upstream/main' }),
  ).toBeVisible()
  await page.keyboard.press('Escape')

  await page.getByRole('button', { name: /Current branch/ }).click()
  await page
    .getByRole('button', { name: 'main', exact: true })
    .click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Set upstream…' }).click()
  const upstream = page.getByRole('dialog', { name: 'Set upstream' })
  await expect(upstream.getByRole('combobox')).toHaveValue('origin/main')
})
