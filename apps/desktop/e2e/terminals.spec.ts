import { expect, test, type Page } from '@playwright/test'

// The terminal sessions in the tabs and in the Terminals view. The story
// keeps the sessions as the engine does: New terminal adds one, and Kill
// takes one away.
const story = (id: string, platform = 'macos') =>
  `/iframe.html?id=screens-workbench--${id}&viewMode=story&globals=a11y.manual:!true&args=platform:${platform}`

async function openTerminals(page: Page, platform = 'macos') {
  await page.goto(story('terminals', platform))
  await page.locator('.xterm-rows').locator('visible=true').first().waitFor()
  await page.getByRole('tab', { name: 'Terminals', exact: true }).click()
  await page.getByRole('list', { name: 'Terminals' }).waitFor()
}

const rows = (page: Page) =>
  page.getByRole('list', { name: 'Terminals' }).getByRole('button')
const editorTab = (page: Page, name: string | RegExp) =>
  page.getByRole('main').getByRole('tab', { name, exact: true })

test('the view lists each session, with one tab stop and the arrow keys', async ({
  page,
}) => {
  await openTerminals(page)
  await expect(rows(page)).toHaveText([
    /^codex · feat\/explorer\s*vvorkflow\.explorer$/,
    /^zsh · feat\/terminal-tabs\s*vvorkflow\.terminal-tabs$/,
  ])
  await rows(page).first().focus()
  await page.keyboard.press('ArrowDown')
  await expect(rows(page).nth(1)).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await expect(rows(page).nth(1)).toBeFocused()
  await page.keyboard.press('Home')
  await expect(rows(page).first()).toBeFocused()
  await page.keyboard.press('End')
  await expect(rows(page).nth(1)).toBeFocused()
  // The list is one tab stop: Tab leaves it.
  await page.keyboard.press('Tab')
  await expect(rows(page).nth(1)).not.toBeFocused()
  await expect(rows(page).first()).not.toBeFocused()
})

test('a closed tab keeps its session, and the view opens the tab again', async ({
  page,
}) => {
  await openTerminals(page)
  const tab = editorTab(page, /^zsh · feat\/terminal-tabs/)
  await tab.click()
  await page.keyboard.press('Meta+w')
  await expect(tab).toHaveCount(0)
  // The session is still in the list.
  await expect(rows(page)).toHaveCount(2)

  await rows(page).nth(1).focus()
  await page.keyboard.press('Enter')
  await expect(tab).toHaveAttribute('aria-selected', 'true')
  await expect(
    page.locator('.xterm-rows').locator('visible=true').first(),
  ).toContainText('git status --short')

  // A session that has a tab only gets its tab in front.
  await rows(page).first().click()
  await expect(editorTab(page, /^codex/)).toHaveAttribute(
    'aria-selected',
    'true',
  )
  await expect(editorTab(page, /^codex/)).toHaveCount(1)
})

test('the menu of a row ends its session: the row and the tab go away', async ({
  page,
}) => {
  await openTerminals(page)
  await rows(page).first().focus()
  await page.keyboard.press('Shift+F10')
  await page.getByRole('menuitem', { name: 'Kill terminal' }).click()
  await expect(rows(page)).toHaveCount(1)
  await expect(editorTab(page, /^codex/)).toHaveCount(0)
  // The focus goes to the row that is left.
  await expect(rows(page).first()).toBeFocused()

  // The last session: the view then has no list, and the focus stays in it.
  await page.keyboard.press('ContextMenu')
  await page.getByRole('menuitem', { name: 'Kill terminal' }).click()
  await expect(page.getByText('No terminals')).toBeVisible()
  await expect(editorTab(page, /^zsh/)).toHaveCount(0)
  await expect(page.locator('body')).not.toBeFocused()
})

test('the menu of a terminal tab ends its session; Close only detaches', async ({
  page,
}) => {
  await openTerminals(page)
  const tab = editorTab(page, /^codex/)
  await tab.click({ button: 'right' })
  await expect(
    page.getByRole('menuitem', { name: 'Close', exact: true }),
  ).toBeVisible()
  await page.getByRole('menuitem', { name: 'Kill terminal' }).click()
  await expect(tab).toHaveCount(0)
  await expect(rows(page)).toHaveCount(1)
  // The Welcome tab is no terminal: its menu has no Kill.
  await editorTab(page, 'Welcome').click({ button: 'right' })
  await expect(
    page.getByRole('menuitem', { name: 'Close', exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole('menuitem', { name: 'Kill terminal' }),
  ).toHaveCount(0)
})

test('New terminal starts a session in a new tab, from the view and from the shortcut', async ({
  page,
}) => {
  await openTerminals(page)
  await page.getByRole('button', { name: 'New terminal' }).click()
  await expect(rows(page)).toHaveCount(3)
  await expect(editorTab(page, 'zsh')).toHaveAttribute('aria-selected', 'true')

  await page.keyboard.press('Meta+Shift+T')
  await expect(rows(page)).toHaveCount(4)
  await expect(editorTab(page, 'zsh')).toHaveCount(2)
})

test('on Linux, the shortcut of New terminal works from a terminal', async ({
  page,
}) => {
  await openTerminals(page, 'linux')
  const input = page.getByRole('textbox', { name: 'Terminal input' })
  await input.focus()
  await expect(input).toBeFocused()
  await page.keyboard.press('Control+Shift+T')
  await expect(rows(page)).toHaveCount(3)
})

test('the Welcome tab starts a terminal, and the empty view too', async ({
  page,
}) => {
  await page.goto(story('macos-dark'))
  await page
    .getByRole('region', { name: 'Start' })
    .getByRole('button', { name: /^New terminal/ })
    .click()
  await expect(editorTab(page, 'zsh')).toHaveAttribute('aria-selected', 'true')

  await page.goto(story('terminals-empty'))
  await page.getByRole('tab', { name: 'Terminals', exact: true }).click()
  await page
    .getByRole('tabpanel', { name: 'Terminals' })
    .getByRole('button', { name: 'New terminal' })
    .click()
  await expect(rows(page)).toHaveCount(1)
  // The button of the empty view is gone: the focus is on a control.
  await expect(page.locator('body')).not.toBeFocused()
})

test('Stop engine asks first, with the focus on Cancel', async ({ page }) => {
  await page.goto(story('stop-engine'))
  const stop = page.getByRole('button', { name: 'Stop engine…' })
  await stop.click()
  const dialog = page.getByRole('dialog', {
    name: 'Stop the engine and its terminals?',
  })
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused()
  // Enter does not stop the engine by accident.
  await page.keyboard.press('Enter')
  await expect(dialog).toBeHidden()
  await expect(stop).toBeFocused()
  await expect(page.getByRole('button', { name: 'Engine error' })).toBeVisible()

  await stop.click()
  await dialog.getByRole('button', { name: 'Stop engine' }).click()
  await expect(dialog).toBeHidden()
  // The story takes the error away, as a new engine does.
  await expect(page.getByRole('button', { name: 'Engine error' })).toHaveCount(
    0,
  )
  await expect(stop).toHaveCount(0)
  await expect(page.locator('body')).not.toBeFocused()
})
