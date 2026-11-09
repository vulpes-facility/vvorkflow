import { expect, test, type Page } from '@playwright/test'

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

// WCAG 2.2 SC 2.4.3: when the side bar opens or closes, the focus stays on a
// visible control.
test('mod+B moves the focus out of the side bar that it closes', async ({
  page,
}) => {
  const content = page.getByRole('region', { name: 'Explorer content' })
  await content.focus()
  await page.keyboard.press('Meta+B')
  await expect(content).toBeHidden()
  await expect(page.getByRole('tab', { name: 'Explorer' })).toBeFocused()
})

test('in a narrow window, the drawer takes the focus from the inert editor area, and gives it back', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 256 })
  await page.goto(
    '/iframe.html?id=screens-workbench--macos-dark&viewMode=story&globals=a11y.manual:!true',
  )
  await page.getByRole('button', { name: 'New project…' }).focus()
  await page.keyboard.press('Meta+B')
  const drawerContent = page.getByRole('region', { name: 'Explorer content' })
  await expect(drawerContent).toBeFocused()

  await page.keyboard.press('Meta+B')
  await expect(drawerContent).toBeHidden()
  await expect(page.getByRole('tab', { name: 'Explorer' })).toBeFocused()
})

const explorerStory =
  '/iframe.html?id=screens-workbench--explorer&viewMode=story&globals=a11y.manual:!true'

test('the Explorer tree has one tab stop and follows the tree keys', async ({
  page,
}) => {
  await page.goto(explorerStory)
  const items = page.getByRole('treeitem')
  await expect(page.locator('[role="treeitem"][tabindex="0"]')).toHaveCount(1)

  const repository = items.first()
  const worktree = page.getByRole('treeitem', { name: /^feat\/terminal-tabs/ })
  await repository.focus()
  await page.keyboard.press('ArrowDown')
  await expect(worktree).toBeFocused()
  await expect(worktree).toHaveAttribute('aria-selected', 'true')

  // On an open node, Left closes it; on a closed node, Left goes to the parent.
  await page.keyboard.press('ArrowLeft')
  await expect(worktree).toHaveAttribute('aria-expanded', 'false')
  await page.keyboard.press('ArrowLeft')
  await expect(repository).toBeFocused()

  // On a closed node, Right opens it; on an open node, Right goes to the first child.
  await page.keyboard.press('ArrowLeft')
  await expect(repository).toHaveAttribute('aria-expanded', 'false')
  await expect(worktree).toBeHidden()
  await page.keyboard.press('ArrowRight')
  await expect(repository).toHaveAttribute('aria-expanded', 'true')
  await page.keyboard.press('ArrowRight')
  await expect(worktree).toBeFocused()
  await page.keyboard.press('ArrowRight')
  await expect(worktree).toHaveAttribute('aria-expanded', 'true')

  await page.keyboard.press('End')
  await expect(items.last()).toBeFocused()
  await page.keyboard.press('Home')
  await expect(repository).toBeFocused()

  // Enter opens and closes a folder.
  const dist = page.getByRole('treeitem', { name: /^dist/ })
  await dist.focus()
  await expect(dist).toHaveAttribute('aria-expanded', 'true')
  await page.keyboard.press('Enter')
  await expect(dist).toHaveAttribute('aria-expanded', 'false')
})

test('a git status has a shape and a name, not only a color', async ({
  page,
}) => {
  await page.goto(explorerStory)
  // A conflict has a warning shape.
  const conflict = page.getByRole('treeitem', {
    name: /^merge-notes\.md\s*,\s*conflict$/,
  })
  const warning = conflict.locator(
    '[data-git-status="conflict"] svg.lucide-triangle-alert',
  )
  await expect(warning).toBeVisible()
  expect((await warning.boundingBox())?.width).toBeGreaterThanOrEqual(12)

  // A change has a filled dot in the color of the status.
  const changed = page.getByRole('treeitem', {
    name: /^editor-area\.tsx\s*,\s*modified$/,
  })
  const dot = changed.locator('[data-git-status="modified"] > span')
  const [width, height, fill, color] = await dot.evaluate((element) => {
    const style = getComputedStyle(element)
    const box = element.getBoundingClientRect()
    return [box.width, box.height, style.backgroundColor, style.color]
  })
  expect(width).toBeGreaterThanOrEqual(6)
  expect(height).toBeGreaterThanOrEqual(6)
  expect(fill).toBe(color)

  // An ignored folder and an ignored file have no shape: their names are in italics.
  for (const name of [
    /^dist\s*,\s*contains ignored files$/,
    /^index\.js\s*,\s*ignored$/,
  ]) {
    const ignored = page.getByRole('treeitem', { name })
    await expect(ignored.locator('[data-git-status]')).toHaveCount(0)
    await expect(ignored.locator('span.italic')).toHaveCSS(
      'font-style',
      'italic',
    )
  }
})

test('the Explorer opens as a drawer at 320 px and keeps the tree usable', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 256 })
  await page.goto(explorerStory)
  await page.getByRole('tab', { name: 'Explorer' }).click()
  const tree = page.getByRole('tree', { name: 'Explorer' })
  await expect(tree).toBeVisible()
  const box = await tree.boundingBox()
  expect(box && box.x + box.width).toBeLessThanOrEqual(320)
  await page.screenshot({
    path: `screens/${test.info().project.name}/drawer-320-explorer.png`,
  })
})

// The focus paths of the side bar that the review of #4 asked for.
test('a click on the open view moves the focus out of the side bar that it closes', async ({
  page,
}) => {
  const button = page
    .getByRole('tabpanel', { name: 'Explorer' })
    .getByRole('button', { name: 'Open folder…' })
  await button.focus()
  await page.getByRole('tab', { name: 'Explorer' }).click()
  await expect(button).toBeHidden()
  await expect(page.getByRole('tab', { name: 'Explorer' })).toBeFocused()
})

test('a window that becomes narrow moves the focus out of the docked side bar', async ({
  page,
}) => {
  const content = page.getByRole('region', { name: 'Explorer content' })
  await content.focus()
  await page.setViewportSize({ width: 320, height: 256 })
  await expect(content).toBeHidden()
  await expect(page.getByRole('tab', { name: 'Explorer' })).toBeFocused()
  await page.setViewportSize({ width: 1440, height: 900 })
  await expect(
    page.getByRole('region', { name: 'Explorer content' }),
  ).toBeVisible()
  await expect(page.getByRole('tab', { name: 'Explorer' })).toBeFocused()
})

test('the first render does not take the focus', async ({ page }) => {
  const focused = await page.evaluate(() => document.activeElement?.tagName)
  expect(focused).toBe('BODY')
})

test('a view shortcut moves the focus from the tree into the new view', async ({
  page,
}) => {
  await page.goto(explorerStory)
  const row = page.getByRole('treeitem', { name: /^scratch\.md/ })
  await row.focus()
  await page.keyboard.press('Meta+Shift+F')
  await expect(row).toBeHidden()
  await expect(
    page.getByRole('region', { name: 'Search content' }),
  ).toBeFocused()
})

/** A change of the repositories that an update from the engine could make. */
type RepositoriesChange =
  { remove: string[] } | { clear: true } | { restore: true }

/**
 * Changes the repositories of the Explorer story. It goes through the args
 * store and the channel of Storybook, so the page gets new data and keeps its
 * state. A removal and a restore start from the repositories of the story.
 */
async function changeRepositories(page: Page, change: RepositoriesChange) {
  // Storybook knows the args of the story only after it renders.
  await page.getByRole('tabpanel', { name: 'Explorer' }).waitFor()
  await page.evaluate((change) => {
    interface Entry {
      id: string
      children?: Entry[]
    }
    interface Group {
      worktrees: { children: Entry[] }[]
    }
    const storyId = 'screens-workbench--explorer'
    const page = window as unknown as {
      __STORYBOOK_PREVIEW__: {
        storyStoreValue: {
          args: { get: (id: string) => { repositories: Group[] } }
        }
        channel: { emit: (event: string, data: unknown) => void }
      }
      storyRepositories?: Group[]
    }
    const preview = page.__STORYBOOK_PREVIEW__
    const original = (page.storyRepositories ??=
      preview.storyStoreValue.args.get(storyId).repositories)
    const removed = 'remove' in change ? change.remove : []
    const keep = (entries: Entry[]): Entry[] =>
      entries
        .filter((entry) => !removed.includes(entry.id))
        .map((entry) =>
          entry.children ? { ...entry, children: keep(entry.children) } : entry,
        )
    const repositories =
      'clear' in change
        ? []
        : original.map((group) => ({
            ...group,
            worktrees: group.worktrees.map((worktree) => ({
              ...worktree,
              children: keep(worktree.children),
            })),
          }))
    preview.channel.emit('updateStoryArgs', {
      storyId,
      updatedArgs: { repositories },
    })
  }, change)
}

test('when an update removes the focused row, the focus moves to the next row', async ({
  page,
}) => {
  await page.goto(explorerStory)
  const scratch = page.getByRole('treeitem', { name: /^scratch\.md/ })
  await scratch.click()
  await expect(scratch).toBeFocused()

  await changeRepositories(page, { remove: ['tt/scratch.md'] })
  await expect(scratch).toBeHidden()
  const readme = page.getByRole('treeitem', { name: 'README.md' }).first()
  await expect(readme).toBeFocused()
  await expect(readme).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('[role="treeitem"][tabindex="0"]')).toHaveCount(1)
})

test('an update does not take the focus when the user works elsewhere', async ({
  page,
}) => {
  await page.goto(explorerStory)
  await page.getByRole('treeitem', { name: /^scratch\.md/ }).click()
  const welcome = page.getByRole('tab', { name: 'Welcome' })
  await welcome.focus()

  await changeRepositories(page, { remove: ['tt/scratch.md'] })
  await expect(
    page.getByRole('treeitem', { name: /^scratch\.md/ }),
  ).toBeHidden()
  await expect(welcome).toBeFocused()
})

test('an empty folder has no expanded state', async ({ page }) => {
  await page.goto(explorerStory)
  await changeRepositories(page, { remove: ['tt/dist/index.js'] })
  const dist = page.getByRole('treeitem', { name: /^dist/ })
  await expect(dist).not.toHaveAttribute('aria-expanded')
  await dist.focus()
  await page.keyboard.press('ArrowRight')
  await expect(dist).toBeFocused()
  await expect(dist).not.toHaveAttribute('aria-expanded')
})

test('when the tree goes away or comes back, the focus stays in the side bar', async ({
  page,
}) => {
  await page.goto(explorerStory)
  await page.getByRole('treeitem', { name: /^scratch\.md/ }).click()

  // The last repository closes: the empty view takes the focus.
  await changeRepositories(page, { clear: true })
  const content = page.getByRole('region', { name: 'Explorer content' })
  await expect(content).toBeFocused()

  // A repository opens while the focus is on the button of the empty view.
  const openFolder = page
    .getByRole('tabpanel', { name: 'Explorer' })
    .getByRole('button', { name: 'Open folder…' })
  await openFolder.focus()
  await changeRepositories(page, { restore: true })
  await expect(openFolder).toBeHidden()
  await expect(page.locator('[role="treeitem"][tabindex="0"]')).toBeFocused()
})

test('when the tree goes away while the user works elsewhere, the focus stays there', async ({
  page,
}) => {
  await page.goto(explorerStory)
  await page.getByRole('treeitem', { name: /^scratch\.md/ }).click()
  const welcome = page.getByRole('tab', { name: 'Welcome' })
  await welcome.focus()

  await changeRepositories(page, { clear: true })
  await expect(page.getByRole('tree')).toBeHidden()
  await expect(welcome).toBeFocused()

  await changeRepositories(page, { restore: true })
  await expect(page.getByRole('tree')).toBeVisible()
  await expect(welcome).toBeFocused()
})
