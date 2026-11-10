import { expect, test } from '@playwright/test'

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
