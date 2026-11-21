import { test, expect } from '../fixtures/test'

// Themes are one CSS variable block per id in src/index.css, so a wrong
// value is a colors regression with nothing on screen to point at it. These
// specs read the variables instead of taking screenshots: one baseline per
// screen is enough to catch a layout drift, and a palette has many values.
const THEMES = [
  { id: 'light', bg: '#ffffff' },
  { id: 'dark', bg: '#16181d' },
  { id: 'nord', bg: '#2e3440' },
  { id: 'catppuccin-latte', bg: '#eff1f5' },
]

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
    expect(await appBg(page), `${theme.id} background`).toBe(theme.bg)
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
