import { expect, test, type Page } from '@playwright/test'

// The projects of the Welcome tab when the engine changes them.
const storyId = 'screens-workbench--macos-dark'

test.beforeEach(async ({ page }) => {
  await page.goto(
    `/iframe.html?id=${storyId}&viewMode=story&globals=a11y.manual:!true`,
  )
  await page.getByRole('button', { name: /^atlas-api\b/ }).waitFor()
})

/** Gives the story new args, as an answer of the engine would. */
async function update(page: Page, args: Record<string, unknown>) {
  await page.evaluate(
    ({ storyId, args }) => {
      const preview = (
        window as unknown as {
          __STORYBOOK_PREVIEW__: {
            channel: { emit: (event: string, data: unknown) => void }
          }
        }
      ).__STORYBOOK_PREVIEW__
      preview.channel.emit('updateStoryArgs', { storyId, updatedArgs: args })
    },
    { storyId, args },
  )
}

const project = (name: string, git = true) => ({
  id: `/home/me/vvorkflow/${name}`,
  name,
  git,
})

test('when the focused project goes away, the focus moves to the project in its place', async ({
  page,
}) => {
  await page.getByRole('button', { name: /^harbor-web\b/ }).focus()
  await update(page, {
    projects: [
      project('atlas-api'),
      project('field-notes', false),
      project('vvorkflow'),
    ],
  })
  await expect(page.getByRole('button', { name: /^harbor-web\b/ })).toBeHidden()
  await expect(page.getByRole('button', { name: /^vvorkflow\b/ })).toBeFocused()
})

test('a project that comes before the focused one does not change where the focus goes', async ({
  page,
}) => {
  await page.getByRole('button', { name: /^harbor-web\b/ }).focus()
  const all = [
    project('atlas-api'),
    project('field-notes', false),
    project('harbor-web'),
    project('vvorkflow'),
  ]
  await update(page, { projects: [project('alpha'), ...all] })
  await expect(page.getByRole('button', { name: /^alpha\b/ })).toBeVisible()
  await expect(
    page.getByRole('button', { name: /^harbor-web\b/ }),
  ).toBeFocused()
  await update(page, {
    projects: [
      project('alpha'),
      ...all.filter(({ name }) => name !== 'harbor-web'),
    ],
  })
  await expect(page.getByRole('button', { name: /^harbor-web\b/ })).toBeHidden()
  await expect(page.getByRole('button', { name: /^vvorkflow\b/ })).toBeFocused()
})

test('when an error takes the place of the projects, the focus moves to the tab and the error is an alert', async ({
  page,
}) => {
  await page.getByRole('button', { name: /^atlas-api\b/ }).focus()
  await update(page, {
    projects: [],
    engineError: 'The projects root /home/me/vvorkflow is not a folder.',
  })
  await expect(
    page.getByRole('region', { name: 'Projects' }).getByRole('alert'),
  ).toHaveText('The projects root /home/me/vvorkflow is not a folder.')
  await expect(
    page
      .getByRole('tabpanel', { name: 'Welcome' })
      .getByRole('region', { name: 'Welcome' }),
  ).toBeFocused()
})

test('the error of the engine is an icon, with its message in a tooltip on focus and on hover', async ({
  page,
}) => {
  const message = 'VVORKFLOW_ROOT is not an absolute path: projects.'
  await update(page, { projects: [], engineError: message })
  const mark = page.getByRole('button', { name: 'Engine error' })
  // On the screen only the icon shows; the alert is for assistive technology.
  await expect(
    page.getByRole('region', { name: 'Projects' }).getByRole('alert'),
  ).toHaveClass(/\bsr-only\b/)

  // The tooltip opens on a keyboard focus.
  await mark.focus()
  await page.keyboard.press('Shift+Tab')
  await page.keyboard.press('Tab')
  await expect(mark).toBeFocused()
  await expect(page.locator('[data-slot="tooltip-content"]')).toHaveText(
    message,
  )
  await page.keyboard.press('Escape')
  await expect(page.locator('[data-slot="tooltip-content"]')).toBeHidden()

  await page.mouse.move(0, 0)
  await mark.hover()
  await expect(page.locator('[data-slot="tooltip-content"]')).toHaveText(
    message,
  )
})

test('an update does not take the focus from another part of the window', async ({
  page,
}) => {
  const explorer = page.getByRole('tab', { name: 'Explorer', exact: true })
  await page.getByRole('button', { name: /^harbor-web\b/ }).focus()
  await explorer.focus()
  await update(page, { projects: [project('atlas-api')] })
  await expect(page.getByRole('button', { name: /^harbor-web\b/ })).toBeHidden()
  await expect(explorer).toBeFocused()
})
