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

test('Home opens the view on the focus, also when the side bar is closed', async ({
  page,
}) => {
  const explorer = page.getByRole('tab', { name: 'Explorer' })
  await explorer.click()
  await expect(explorer).toHaveAttribute('aria-expanded', 'false')
  await page.keyboard.press('Home')
  await expect(explorer).toHaveAttribute('aria-expanded', 'true')
  await expect(page.getByRole('tabpanel', { name: 'Explorer' })).toBeVisible()
})

// WCAG 2.2 SC 1.4.10: at 320 CSS pixels the side bar opens as a drawer over
// the editor area, and nothing scrolls horizontally.
for (const platform of ['macos', 'windows', 'linux'] as const) {
  test(`the side bar opens as a drawer at 320 px (${platform})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 256 })
    const story = {
      macos: 'macos-dark',
      windows: 'windows-dark',
      linux: 'linux-dark',
    }[platform]
    await page.goto(
      `/iframe.html?id=screens-workbench--${story}&viewMode=story&globals=a11y.manual:!true`,
    )
    const explorer = page.getByRole('tab', { name: 'Explorer' })
    await expect(explorer).toHaveAttribute('aria-expanded', 'false')

    await explorer.click()
    const panel = page.getByRole('tabpanel', { name: 'Explorer' })
    await expect(panel).toBeVisible()
    const box = await panel.boundingBox()
    expect(box && box.x + box.width).toBeLessThanOrEqual(320)
    // The editor area under the drawer is inert, so the keyboard cannot reach it.
    const editorInert = await page
      .getByRole('tab', { name: 'Welcome' })
      .evaluate((tab) => tab.closest('[inert]') !== null)
    expect(editorInert).toBe(true)
    // The header row stays above the drawer, so the window buttons stay usable.
    if (platform !== 'macos') {
      const close = page.getByRole('button', { name: 'Close' })
      await expect(close).toBeVisible()
      expect(
        await close.evaluate((button) => button.closest('[inert]') === null),
      ).toBe(true)
    }
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth,
    )
    expect(overflow).toBe(false)

    await page.screenshot({
      path: `screens/${test.info().project.name}/drawer-320-${platform}.png`,
    })

    await page.keyboard.press('Escape')
    await expect(panel).toBeHidden()
    await expect(explorer).toBeFocused()
  })
}

test('the separator is off at 320 px, so the keyboard cannot reopen the docked panel', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 256 })
  await page.goto(
    '/iframe.html?id=screens-workbench--windows-dark&viewMode=story&globals=a11y.manual:!true',
  )
  const separator = page.getByRole('separator')
  await expect(separator).toHaveAttribute('aria-disabled', 'true')
  expect(await separator.getAttribute('tabindex')).toBeNull()
  const close = page.getByRole('button', { name: 'Close' })
  const before = await close.boundingBox()
  await separator.evaluate((element) => element.focus())
  for (let step = 0; step < 10; step++) await page.keyboard.press('ArrowRight')
  expect(await close.boundingBox()).toEqual(before)
})
