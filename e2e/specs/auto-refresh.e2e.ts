import { test, expect, type E2e } from '../fixtures/test'

test.use({ withRepo: true })

// The watcher in src-tauri/src/watch.rs says the repository changed; the
// app shows the change without a click or a focus.
test('changes on disk show up by themselves', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText('Add b')).toBeVisible()
  await page.getByRole('button', { name: /^Changes/ }).click()
  await expect(page.getByText('No local changes')).toBeVisible()

  const emit = (path: string) =>
    page.evaluate((path) => {
      const e2e = (window as unknown as { e2e: E2e }).e2e
      e2e.editOnDisk()
      e2e.emit('repo-changed', path)
    }, path)

  // Another repository changing is none of this one's business.
  await emit('/home/e2e/other')
  await page.waitForTimeout(200)
  await expect(page.getByText('No local changes')).toBeVisible()

  await emit('/home/e2e/demo')
  await expect(page.getByTitle('src/app.ts')).toBeVisible()
})

test('background fetching is picked in the Remotes dialog', async ({
  page,
}) => {
  await page.goto('/')
  await page.keyboard.press(
    process.platform === 'darwin' ? 'Meta+k' : 'Control+k',
  )
  await page.getByRole('combobox').fill('remotes')
  await page.keyboard.press('Enter')
  const dialog = page.getByRole('dialog', { name: 'Remotes' })
  const every = dialog.getByLabel('Fetch in the background')
  await expect(every).toHaveValue('0')
  await every.selectOption({ label: 'Every 15 min' })

  await page.reload()
  await page.keyboard.press(
    process.platform === 'darwin' ? 'Meta+k' : 'Control+k',
  )
  await page.getByRole('combobox').fill('remotes')
  await page.keyboard.press('Enter')
  await expect(
    page
      .getByRole('dialog', { name: 'Remotes' })
      .getByLabel('Fetch in the background'),
  ).toHaveValue('15')
})
