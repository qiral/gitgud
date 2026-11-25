import { THEMES } from '../../src/lib/themes'
import { test, expect } from '../fixtures/test'

// Themes are one CSS variable block per id in src/index.css, so a wrong
// value is a colors regression with nothing on screen to point at it. These
// specs read the variables instead of taking screenshots: one baseline per
// screen is enough to catch a layout drift, and a palette has many values.
async function appBg(page: import('@playwright/test').Page) {
  const value = await page.evaluate(() =>
    getComputedStyle(document.documentElement)
      .getPropertyValue('--app-bg')
      .trim()
      .toLowerCase(),
  )
  return value
}

test('every theme paints its own colors', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'GitGud' })).toBeVisible()

  // Whatever the OS says, the app starts on a known theme.
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  expect(await appBg(page)).toBe('#ffffff')

  for (const theme of THEMES) {
    await page.evaluate((id) => {
      document.documentElement.dataset.theme = id
    }, theme.id)

    await expect(page.locator('html')).toHaveAttribute('data-theme', theme.id)
    expect(await appBg(page), `${theme.id} background`).toMatch(/^#/)
    // A theme without its own block would keep the light colors.
    const scheme = await page.evaluate(
      () => getComputedStyle(document.documentElement).colorScheme,
    )
    expect(scheme, theme.id).toBe(theme.dark ? 'dark' : 'light')
  }

  // The body follows the variable, not just the attribute.
  await page.evaluate(() => {
    document.documentElement.dataset.theme = 'dark'
  })
  const bodyBg = await page.evaluate(
    () => getComputedStyle(document.body).backgroundColor,
  )
  expect(bodyBg).toBe('rgb(22, 24, 29)')
})

test('picks a theme in the appearance dialog and keeps it', async ({
  page,
}) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Appearance' }).click()
  const dialog = page.getByRole('dialog', { name: 'Appearance' })
  await dialog.getByRole('checkbox', { name: 'Match system' }).uncheck()
  await dialog.getByPlaceholder('Search themes').fill('synth')
  await dialog.getByRole('button', { name: 'Synthwave' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'synthwave')
  await dialog.getByRole('button', { name: 'Teal' }).click()

  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'synthwave')
  const accent = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--app-accent'),
  )
  expect(accent).toBe('#5fd9cb')
})

test('the options stay clear of the scrollbar', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Appearance' }).click()
  const dialog = page.getByRole('dialog', { name: 'Appearance' })
  const column = dialog.locator('.overflow-y-auto').last()
  // The innermost right edge the scrollbar can reach.
  const edge = await column.evaluate(
    (el) => el.getBoundingClientRect().left + el.clientLeft + el.clientWidth,
  )
  for (const control of [
    dialog.getByRole('button', { name: 'Larger' }),
    dialog.getByRole('checkbox', { name: 'Syntax highlighting' }),
    dialog.getByRole('textbox', { name: 'Font' }),
  ]) {
    const box = (await control.boundingBox())!
    expect(box.x + box.width).toBeLessThanOrEqual(edge - 10)
  }
  await dialog.getByText('Syntax highlighting').click()
  await expect(
    dialog.getByRole('checkbox', { name: 'Syntax highlighting' }),
  ).not.toBeChecked()
})

test('follows the system between the two picked themes', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Appearance' }).click()
  const dialog = page.getByRole('dialog', { name: 'Appearance' })
  await dialog.getByRole('button', { name: 'Gruvbox Light' }).click()
  await dialog.getByRole('button', { name: 'Dracula' }).click()
  const html = page.locator('html')
  await expect(html).toHaveAttribute('data-theme', 'gruvbox-light')
  await page.emulateMedia({ colorScheme: 'dark' })
  await expect(html).toHaveAttribute('data-theme', 'dracula')
})

test.describe('in a repository', () => {
  test.use({ withRepo: true })

  test('the palette previews themes and Escape takes it back', async ({
    page,
  }) => {
    await page.goto('/')
    const html = page.locator('html')
    await page.keyboard.press('ControlOrMeta+k')
    await page.getByRole('combobox').fill('change theme')
    await page.keyboard.press('Enter')
    await page.getByRole('combobox').fill('dracula')
    await expect(html).toHaveAttribute('data-theme', 'dracula')
    await page.keyboard.press('Escape')
    await expect(html).toHaveAttribute('data-theme', 'light')

    await page.keyboard.press('ControlOrMeta+,')
    await expect(page.getByRole('dialog', { name: 'Appearance' })).toBeVisible()
  })
})
