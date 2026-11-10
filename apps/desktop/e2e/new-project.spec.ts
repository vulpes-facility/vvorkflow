import { expect, test, type Page } from '@playwright/test'

// The New project dialog of the Welcome tab.
const story = (id: string) =>
  `/iframe.html?id=screens-workbench--${id}&viewMode=story&globals=a11y.manual:!true`

test('the shortcut opens the dialog, Enter makes the project, and the focus comes back', async ({
  page,
}) => {
  await page.goto(story('macos-dark'))
  const action = page.getByRole('button', { name: 'New project…' })
  await action.focus()
  await page.keyboard.press('Meta+N')
  const dialog = page.getByRole('dialog', { name: 'New project' })
  const name = dialog.getByRole('textbox', { name: 'Name' })
  await expect(name).toBeFocused()

  // A name of spaces only is no name.
  const create = dialog.getByRole('button', { name: 'Create' })
  await expect(create).toBeDisabled()
  await page.keyboard.type('  ')
  await expect(create).toBeDisabled()
  await page.keyboard.press('Enter')
  await expect(dialog).toBeVisible()

  await page.keyboard.type('harbor-api')
  await page.keyboard.press('Enter')
  await expect(dialog).toBeHidden()
  await expect(action).toBeFocused()
})

test('the dialog keeps the focus, and Escape closes it', async ({ page }) => {
  await page.goto(story('macos-dark'))
  const action = page.getByRole('button', { name: 'New project…' })
  await action.click()
  const dialog = page.getByRole('dialog', { name: 'New project' })
  const name = dialog.getByRole('textbox', { name: 'Name' })
  await expect(name).toBeFocused()

  // The shortcuts of the window do not take the focus out of the dialog,
  // and do not change the window under it.
  await page.keyboard.press('F6')
  await expect(name).toBeFocused()
  await page.keyboard.press('Meta+B')
  await page.keyboard.press('Meta+W')
  await expect(name).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(name).toBeFocused()

  await page.keyboard.type('draft')
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(action).toBeFocused()

  await expect(page.getByRole('tabpanel', { name: 'Explorer' })).toBeVisible()
  await expect(page.getByRole('tabpanel', { name: 'Welcome' })).toBeVisible()

  // The dialog starts empty each time.
  await action.click()
  await expect(name).toHaveValue('')
})

test('a refused name stays in the dialog, with the error as an icon and an alert', async ({
  page,
}) => {
  await page.goto(story('new-project-error'))
  await page.getByRole('button', { name: 'New project…' }).click()
  const dialog = page.getByRole('dialog', { name: 'New project' })
  const name = dialog.getByRole('textbox', { name: 'Name' })
  await name.fill('  atlas-api ')
  await page.keyboard.press('Enter')

  // The engine gets the name without the spaces around it.
  const message = 'atlas-api is in the projects root already.'
  await expect(dialog.getByRole('alert')).toHaveText(message)
  await expect(dialog.getByRole('alert')).toHaveClass(/\bsr-only\b/)
  await expect(name).toBeFocused()
  await expect(name).toHaveAttribute('aria-invalid', 'true')
  await expect(name).toHaveAccessibleDescription(message)

  // The tooltip of the icon opens on a keyboard focus.
  await page.keyboard.press('Tab')
  const mark = dialog.getByRole('button', { name: 'Name error' })
  await expect(mark).toBeFocused()
  const tooltip = page.locator('[data-slot="tooltip-content"]')
  await expect(tooltip).toHaveText(message)
  // Escape closes the tooltip first, and the dialog stays.
  await page.keyboard.press('Escape')
  await expect(tooltip).toBeHidden()
  await expect(dialog).toBeVisible()

  // A change of the name takes the error away.
  await name.fill('atlas-api-2')
  await expect(dialog.getByRole('alert')).toHaveCount(0)
  await expect(name).not.toHaveAttribute('aria-invalid')
})

/**
 * Gives the story an engine that answers only when the test tells it to:
 * `finish()` makes the project, and `refuse()` refuses the name.
 */
async function withSlowEngine(page: Page) {
  await page.goto(story('macos-dark'))
  await page.getByRole('button', { name: 'New project…' }).waitFor()
  await page.evaluate(() => {
    const state = window as unknown as {
      requests: {
        name: string
        aborted: () => boolean
        finish: () => void
        refuse: () => void
      }[]
      __STORYBOOK_PREVIEW__: {
        channel: { emit: (event: string, data: unknown) => void }
      }
    }
    state.requests = []
    state.__STORYBOOK_PREVIEW__.channel.emit('updateStoryArgs', {
      storyId: 'screens-workbench--macos-dark',
      updatedArgs: {
        onCreateProject: (name: string, signal: AbortSignal) =>
          new Promise<void>((resolve, reject) => {
            state.requests.push({
              name,
              aborted: () => signal.aborted,
              finish: resolve,
              refuse: () =>
                reject(new Error(`${name} is in the projects root already.`)),
            })
          }),
      },
    })
  })
}

type Requests = {
  requests: {
    name: string
    aborted: () => boolean
    finish: () => void
    refuse: () => void
  }[]
}

test('an answer that comes after the close does nothing, also while the dialog fades out', async ({
  page,
}) => {
  await withSlowEngine(page)
  const action = page.getByRole('button', { name: 'New project…' })
  const dialog = page.getByRole('dialog', { name: 'New project' })
  const name = dialog.getByRole('textbox', { name: 'Name' })
  await action.click()
  await name.fill('first')
  await page.keyboard.press('Enter')
  await expect(dialog.getByRole('button', { name: 'Create' })).toBeDisabled()

  // The signal aborts with the close, before the dialog is gone.
  await page.keyboard.press('Escape')
  expect(
    await page.evaluate(() =>
      (window as unknown as Requests).requests[0].aborted(),
    ),
  ).toBe(true)

  // The dialog opens again at once, with a new form.
  await action.dispatchEvent('click')
  await expect(name).toHaveValue('')
  await expect(name).not.toHaveAttribute('readonly')
  await name.fill('second')
  await page.evaluate(() =>
    (window as unknown as Requests).requests[0].finish(),
  )
  await page.waitForTimeout(300)
  await expect(dialog).toBeVisible()
  await expect(name).toHaveValue('second')
  await expect(dialog.getByRole('button', { name: 'Create' })).toBeEnabled()

  // The answer to the open dialog closes it.
  await page.keyboard.press('Enter')
  await page.evaluate(() => {
    const [, second] = (window as unknown as Requests).requests
    if (second.aborted()) throw new Error('the open dialog is aborted')
    second.finish()
  })
  await expect(dialog).toBeHidden()
})

test('the name cannot change while the engine works, so a refusal is about the name on the screen', async ({
  page,
}) => {
  await withSlowEngine(page)
  await page.getByRole('button', { name: 'New project…' }).click()
  const dialog = page.getByRole('dialog', { name: 'New project' })
  const name = dialog.getByRole('textbox', { name: 'Name' })
  await name.fill('existing')
  await page.keyboard.press('Enter')

  // The field keeps the focus, and takes no key.
  await expect(name).toBeFocused()
  await expect(name).toHaveAttribute('readonly')
  await page.keyboard.type('-2')
  await page.keyboard.press('Enter')
  await expect(name).toHaveValue('existing')
  expect(
    await page.evaluate(() => (window as unknown as Requests).requests.length),
  ).toBe(1)

  await page.evaluate(() =>
    (window as unknown as Requests).requests[0].refuse(),
  )
  await expect(dialog.getByRole('alert')).toHaveText(
    'existing is in the projects root already.',
  )
  await expect(name).toBeFocused()
  await expect(name).not.toHaveAttribute('readonly')
  await page.keyboard.type('-2')
  await expect(name).toHaveValue('existing-2')
})
