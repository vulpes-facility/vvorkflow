import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

// The menu of an editor tab: the way to move a tab without a drag
// (WCAG 2.2 SC 2.5.7), with the pointer and with the keyboard.
const terminalStory =
  '/iframe.html?id=screens-workbench--terminal&viewMode=story&globals=a11y.manual:!true'

test.beforeEach(async ({ page }) => {
  await page.goto(terminalStory)
  await page.locator('.xterm-rows').filter({ visible: true }).first().waitFor()
})

const tab = (name: RegExp) => (page: import('@playwright/test').Page) =>
  page.getByRole('tab', { name })
const agentTab = tab(/^codex · feat\/explorer/)
const shellTab = tab(/^zsh · feat\/terminal-tabs/)

test('a right-click on a tab opens its menu, which splits and moves the tab', async ({
  page,
}, testInfo) => {
  await agentTab(page).click({ button: 'right' })
  const menu = page.getByRole('menu')
  await expect(menu).toBeVisible()
  await expect(menu.getByRole('menuitem')).toHaveText([
    'Close',
    'Close others',
    'Split right',
  ])

  // The menu passes the WCAG 2.2 A and AA rules, and each item is 24 px high or more.
  const results = await new AxeBuilder({ page })
    .include('[role="menu"]')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze()
  expect(results.violations.map(({ id }) => id)).toEqual([])
  for (const box of await menu
    .getByRole('menuitem')
    .evaluateAll((items) =>
      items.map((item) => item.getBoundingClientRect().height),
    ))
    expect(box).toBeGreaterThanOrEqual(24)
  await page.screenshot({
    path: `screens/${testInfo.project.name}/tab-menu.png`,
  })

  await menu.getByRole('menuitem', { name: 'Split right' }).click()
  await expect(page.locator('.dv-groupview')).toHaveCount(2)
  await expect(agentTab(page)).toBeFocused()

  // Alone in its new group, the tab can only close or move back.
  await agentTab(page).click({ button: 'right' })
  await expect(menu.getByRole('menuitem')).toHaveText([
    'Close',
    'Move to previous group',
  ])
  await menu.getByRole('menuitem', { name: 'Move to previous group' }).click()
  await expect(page.locator('.dv-groupview')).toHaveCount(1)
  await expect(agentTab(page)).toBeFocused()
})

test('Shift+F10 opens the menu of the focused tab, and the focus stays on a tab', async ({
  page,
}) => {
  await shellTab(page).focus()
  await page.keyboard.press('Shift+F10')
  const menu = page.getByRole('menu')
  await expect(menu).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(menu).toBeHidden()
  await expect(shellTab(page)).toBeFocused()

  // Close takes the tab away, so the focus goes to the tab that is active next.
  await page.keyboard.press('Shift+F10')
  await page.keyboard.press('ArrowDown')
  await expect(
    menu.getByRole('menuitem', { name: 'Close', exact: true }),
  ).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(shellTab(page)).toBeHidden()
  await expect(
    page.locator('.dv-active-group [role="tab"][aria-selected="true"]'),
  ).toBeFocused()
})

test('the menu of the side bar header sets its width without a drag', async ({
  page,
}) => {
  const panel = page.getByRole('tabpanel', { name: 'Explorer' })
  const width = async () => (await panel.boundingBox())?.width ?? 0
  const header = panel.getByRole('heading', { name: 'Explorer' })

  await header.click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Wide' }).click()
  await expect.poll(width).toBe(420)
  await header.click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Narrow' }).click()
  await expect.poll(width).toBe(240)
  await header.click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Default width' }).click()
  await expect.poll(width).toBe(300)
  await expect(page.locator('body')).not.toBeFocused()
})
