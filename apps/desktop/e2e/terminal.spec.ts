import { expect, test, type Page } from '@playwright/test'

// The keyboard behavior of a terminal tab, and the F6 way between the regions.
const terminalStory = (platform: 'macos' | 'linux') =>
  `/iframe.html?id=screens-workbench--terminal&viewMode=story&globals=a11y.manual:!true&args=platform:${platform}`

async function openTerminal(page: Page, platform: 'macos' | 'linux') {
  await page.goto(terminalStory(platform))
  await page.locator('.xterm-rows').filter({ visible: true }).first().waitFor()
  const input = page.getByRole('textbox', { name: 'Terminal input' })
  await input.focus()
  return input
}

test('on Linux, the Ctrl keys and Tab go to the program, and F6 leaves the terminal', async ({
  page,
}) => {
  const input = await openTerminal(page, 'linux')
  await expect(input).toHaveAccessibleDescription(/F6/)
  await expect(page.getByText('F6 leaves the terminal')).toBeVisible()

  // Ctrl+W deletes a word in a shell; it must not close the tab.
  await page.keyboard.press('Control+W')
  await page.keyboard.press('Control+B')
  await page.keyboard.press('Tab')
  await expect(input).toBeFocused()
  await expect(
    page.getByRole('tab', { name: /^zsh · feat\/terminal-tabs/ }),
  ).toBeVisible()
  await expect(page.getByRole('tabpanel', { name: 'Explorer' })).toBeVisible()

  // A Ctrl+Shift letter goes to the workbench, as in other terminal emulators.
  await page.keyboard.press('Control+Shift+F')
  await expect(page.getByRole('tab', { name: 'Search' })).toHaveAttribute(
    'aria-selected',
    'true',
  )

  await page.keyboard.press('F6')
  await expect(input).not.toBeFocused()
  await expect(page.locator('[data-region="status-bar"] :focus')).toHaveCount(1)
  await expect(page.getByText('F6 leaves the terminal')).toBeHidden()
  await page.keyboard.press('Shift+F6')
  await expect(input).toBeFocused()
})

test('on macOS, the Command keys reach the workbench from a terminal', async ({
  page,
}) => {
  const input = await openTerminal(page, 'macos')
  await page.keyboard.press('Meta+B')
  await expect(page.getByRole('tabpanel', { name: 'Explorer' })).toBeHidden()
  await expect(input).toBeFocused()

  await page.keyboard.press('Meta+W')
  await expect(
    page.getByRole('tab', { name: /^zsh · feat\/terminal-tabs/ }),
  ).toBeHidden()
})

test('F6 and Shift+F6 move the focus through the regions of the window', async ({
  page,
}) => {
  await page.goto(terminalStory('macos'))
  await page.locator('.xterm-rows').filter({ visible: true }).first().waitFor()
  const activity = page.getByRole('tab', { name: 'Explorer', exact: true })
  await activity.focus()

  await page.keyboard.press('F6')
  await expect(page.locator('[role="treeitem"][tabindex="0"]')).toBeFocused()
  await page.keyboard.press('F6')
  await expect(
    page.getByRole('tab', { name: /^zsh · feat\/terminal-tabs/ }),
  ).toBeFocused()
  await page.keyboard.press('F6')
  await expect(
    page.getByRole('textbox', { name: 'Terminal input' }),
  ).toBeFocused()
  await page.keyboard.press('F6')
  await expect(page.locator('[data-region="status-bar"] :focus')).toHaveCount(1)
  await page.keyboard.press('F6')
  await expect(activity).toBeFocused()

  await page.keyboard.press('Shift+F6')
  await expect(page.locator('[data-region="status-bar"] :focus')).toHaveCount(1)
})

test('a terminal keeps its output while another tab is open', async ({
  page,
}) => {
  await openTerminal(page, 'macos')
  const shell = page.locator('[data-terminal]').filter({ hasText: 'pnpm test' })
  await shell.evaluate((element) => element.setAttribute('data-probe', ''))

  await page.getByRole('tab', { name: /^codex · feat\/explorer/ }).click()
  await expect(shell).toBeHidden()
  // This session started in a hidden tab: it opens now, with its output and
  // a grid that fills the tab.
  const agent = page
    .locator('[data-terminal]')
    .filter({ hasText: '~/code/vvorkflow.explorer' })
  await expect(agent).toBeVisible()
  const [screenWidth, hostWidth] = await agent.evaluate((element) => [
    element.querySelector('.xterm-screen')?.getBoundingClientRect().width ?? 0,
    element.getBoundingClientRect().width,
  ])
  expect(screenWidth).toBeGreaterThan(hostWidth * 0.9)
  await page.getByRole('tab', { name: /^zsh · feat\/terminal-tabs/ }).click()
  // The same terminal comes back, with its output; it was not made again.
  await expect(page.locator('[data-terminal][data-probe]')).toBeVisible()
  await expect(page.locator('[data-terminal][data-probe]')).toContainText(
    'pnpm test',
  )
})
