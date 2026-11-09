import { expect, test } from '@playwright/test'

// The keyboard behavior of the activity bar and the side bar.
test.beforeEach(async ({ page }) => {
  await page.goto(
    '/iframe.html?id=screens-workbench--macos-dark&viewMode=story&globals=a11y.manual:!true',
  )
  await page.getByRole('tab', { name: 'Explorer' }).waitFor()
})

test('an arrow key opens the next view and never closes the side bar', async ({
  page,
}) => {
  const explorer = page.getByRole('tab', { name: 'Explorer' })
  const search = page.getByRole('tab', { name: 'Search' })
  await explorer.focus()
  // The view shortcut selects Search, while the focus stays on Explorer.
  await page.keyboard.press('Meta+Shift+F')
  await expect(search).toHaveAttribute('aria-selected', 'true')
  await page.keyboard.press('ArrowDown')
  await expect(search).toBeFocused()
  await expect(search).toHaveAttribute('aria-selected', 'true')
  await expect(search).toHaveAttribute('aria-expanded', 'true')
  await expect(page.getByRole('tabpanel', { name: 'Search' })).toBeVisible()
})

test('the open view toggles the side bar, and its tab tells the state', async ({
  page,
}) => {
  const explorer = page.getByRole('tab', { name: 'Explorer' })
  await explorer.click()
  await expect(explorer).toHaveAttribute('aria-expanded', 'false')
  await expect(explorer).toHaveAttribute('aria-selected', 'false')
  await expect(page.getByRole('tabpanel', { name: 'Explorer' })).toBeHidden()
  await page.keyboard.press('Meta+B')
  await expect(explorer).toHaveAttribute('aria-expanded', 'true')
  await expect(explorer).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('tabpanel', { name: 'Explorer' })).toBeVisible()
})
