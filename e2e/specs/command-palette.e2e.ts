import { test, expect } from '../fixtures/test'

test.use({ withRepo: true })

const mod = process.platform === 'darwin' ? 'Meta' : 'Control'

// The palette lists every action, and its shortcuts work anywhere in the
// repository view.
test('the command palette switches branches', async ({ page }) => {
  await page.goto('/')
  const branch = page.getByRole('button', { name: /Current branch/ })
  await expect(branch).toContainText('main')

  await page.keyboard.press(`${mod}+k`)
  const palette = page.getByRole('dialog', { name: 'Command palette' })
  await expect(palette).toBeVisible()
  await palette.getByRole('combobox').fill('switch br')
  await page.keyboard.press('Enter')

  // Enter on a command with a list opens that list.
  await expect(palette.getByRole('combobox')).toHaveAttribute(
    'placeholder',
    'Switch to branch',
  )
  await palette.getByRole('combobox').fill('login')
  await page.keyboard.press('Enter')

  await expect(palette).toBeHidden()
  await expect(branch).toContainText('feature/login')
})

test('shortcuts open lists and dialogs directly', async ({ page }) => {
  await page.goto('/')
  await expect(
    page.getByRole('button', { name: /Current branch/ }),
  ).toBeVisible()

  await page.keyboard.press(`${mod}+b`)
  const palette = page.getByRole('dialog', { name: 'Command palette' })
  await expect(palette.getByRole('option', { name: 'fix/typo' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(palette).toBeHidden()

  await page.keyboard.press('F1')
  const keys = page.getByRole('dialog', { name: 'Keyboard shortcuts' })
  await expect(keys).toBeVisible()
  await expect(keys.getByText('Switch branch…')).toBeVisible()
})
