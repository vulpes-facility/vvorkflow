import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { calls, content, mod, open, probe, setText } from './editor-helpers.js'

// The behavior of the code editor and the diff editor.

test('typing tells the dirty state once, and again when the text is equal', async ({
  page,
}) => {
  await open(page, 'harness')
  await content(page).click()
  await page.keyboard.press('ControlOrMeta+End')
  await page.keyboard.type('xy')
  expect(await calls(page)).toEqual(['dirty:true'])
  await page.keyboard.press('Backspace')
  expect(await calls(page)).toEqual(['dirty:true'])
  await page.keyboard.press('Backspace')
  expect(await calls(page)).toEqual(['dirty:true', 'dirty:false'])
})

test('F6 is not taken by the editor, and Escape then Tab leaves it', async ({
  page,
}) => {
  await open(page, 'harness')
  const seen = await page.evaluate(() => {
    const events: { key: string; prevented: boolean }[] = []
    window.addEventListener('keydown', (event) => {
      if (event.key === 'F6')
        events.push({ key: event.key, prevented: event.defaultPrevented })
    })
    ;(window as unknown as { f6: typeof events }).f6 = events
    return events.length
  })
  expect(seen).toBe(0)
  await content(page).focus()
  await page.keyboard.press('F6')
  await page.keyboard.press('Shift+F6')
  expect(
    await page.evaluate(() => (window as unknown as { f6: unknown[] }).f6),
  ).toEqual([
    { key: 'F6', prevented: false },
    { key: 'F6', prevented: false },
  ])
  expect(await calls(page)).toEqual([])

  // Tab indents, so it does not leave the editor.
  await page.keyboard.press('Tab')
  await expect(content(page)).toBeFocused()
  await page.keyboard.press('Escape')
  await page.keyboard.press('Tab')
  await expect(page.getByRole('button', { name: 'Next control' })).toBeFocused()
})

test('the content has a name with the file, and a description with the way out', async ({
  page,
}) => {
  await open(page, 'harness')
  const input = page.getByRole('textbox', { name: 'src/queue/job-queue.ts' })
  await expect(input).toHaveAccessibleDescription(/F6/)
  await expect(input).toHaveAccessibleDescription(/Escape/)
})

test('a read-only file refuses input, and still takes the focus', async ({
  page,
}) => {
  await open(page, 'harness', '&args=readOnly:!true')
  await content(page).click()
  await page.keyboard.type('xyz')
  await page.keyboard.press('Backspace')
  await expect(content(page)).not.toContainText('xyz')
  await expect(content(page)).toContainText('import { EventEmitter }')
  expect(await calls(page)).toEqual([])
  await expect(content(page)).toBeFocused()
})

test('mod+F opens the search with the selection, and the keys work in its field', async ({
  page,
}) => {
  await open(page, 'harness')
  await content(page).click()
  // Select the word `JobQueue` with a double click.
  await page.getByText('JobQueue', { exact: false }).first().dblclick()
  await page.keyboard.press(`${await mod(page)}+f`)
  const field = page.getByRole('textbox', { name: 'Find' })
  await expect(field).toBeFocused()
  await expect(field).toHaveValue(/Job/)
  await field.fill('job')
  const count = page.locator('.cm-vv-search [aria-live="polite"]')
  await expect(count).toContainText(/\d+/)
  await expect(page.locator('.cm-searchMatch').first()).toBeVisible()
  const outline = await page
    .locator('.cm-searchMatch')
    .first()
    .evaluate((element) => getComputedStyle(element).outlineStyle)
  expect(outline).toBe('solid')

  // Enter and Shift+Enter move between the matches.
  await page.keyboard.press('Enter')
  await expect(count).toHaveText(/^\d+ of \d+$/)
  const first = await count.textContent()
  await page.keyboard.press('Enter')
  expect(await count.textContent()).not.toBe(first)
  await page.keyboard.press('Shift+Enter')
  expect(await count.textContent()).toBe(first)

  // A toggle tells its state with aria-pressed.
  const toggle = page.getByRole('button', { name: 'Match case' })
  await expect(toggle).toHaveAttribute('aria-pressed', 'false')
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')

  // No match shows 0.
  await field.fill('zzzzzz')
  await expect(count).toHaveText('0')

  // Escape closes the panel and gives the focus back to the editor.
  await page.keyboard.press('Escape')
  await expect(page.locator('.cm-vv-search')).toBeHidden()
  await expect(content(page)).toBeFocused()
})

test('the replace row replaces, and a wrong regular expression shows on the field', async ({
  page,
}) => {
  await open(page, 'harness')
  await content(page).click()
  await page.keyboard.press(`${await mod(page)}+f`)
  const disclosure = page.getByRole('button', { name: 'Show replace' })
  await expect(disclosure).toHaveAttribute('aria-expanded', 'false')
  await expect(page.getByRole('textbox', { name: 'Replace' })).toHaveCount(0)
  await disclosure.click()
  await expect(disclosure).toHaveAttribute('aria-expanded', 'true')

  await page.getByRole('textbox', { name: 'Find' }).fill('MAX_ATTEMPTS')
  await page.getByRole('textbox', { name: 'Replace' }).fill('LIMIT')
  await page.getByRole('button', { name: 'Replace all' }).click()
  await expect(content(page)).toContainText('const LIMIT = 3')
  expect(await calls(page)).toEqual(['dirty:true'])

  await page.getByRole('button', { name: 'Regular expression' }).click()
  const field = page.getByRole('textbox', { name: 'Find' })
  await field.fill('(')
  await expect(field).toHaveAttribute('aria-invalid', 'true')
  await expect(page.getByRole('alert')).toHaveCount(1)
  await field.fill('LIM.T')
  await expect(field).not.toHaveAttribute('aria-invalid', 'true')
})

test('a read-only editor has no replace row', async ({ page }) => {
  await open(page, 'harness', '&args=readOnly:!true')
  await content(page).click()
  await page.keyboard.press(`${await mod(page)}+f`)
  await expect(page.getByRole('textbox', { name: 'Find' })).toBeFocused()
  await expect(page.getByRole('button', { name: 'Show replace' })).toHaveCount(
    0,
  )
})

test('each button of the search panel is 24 pixels or more and has a name', async ({
  page,
}) => {
  await open(page, 'harness')
  await content(page).click()
  await page.keyboard.press(`${await mod(page)}+f`)
  await page.getByRole('button', { name: 'Show replace' }).click()
  const sizes = await page.locator('.cm-vv-search button').evaluateAll((all) =>
    all.map((element) => {
      const { width, height } = element.getBoundingClientRect()
      return { name: element.getAttribute('aria-label'), width, height }
    }),
  )
  expect(sizes.length).toBeGreaterThanOrEqual(9)
  for (const { name, width, height } of sizes) {
    expect(name).toBeTruthy()
    expect(width).toBeGreaterThanOrEqual(24)
    expect(height).toBeGreaterThanOrEqual(24)
  }
})

test('the diff is two columns when wide and one when narrow, and keeps the edits', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1200, height: 700 })
  await open(page, 'diff-harness')
  await expect(page.locator('.cm-editor')).toHaveCount(2)
  await expect(page.locator('.cm-changeGutter').first()).toBeVisible()
  await content(page).click()
  await page.keyboard.type('zzz')
  expect(await calls(page)).toEqual(['dirty:true'])

  await page.setViewportSize({ width: 500, height: 700 })
  await expect(page.locator('.cm-editor')).toHaveCount(1)
  await expect(content(page)).toContainText('zzz')
  expect(await calls(page)).toEqual(['dirty:true'])

  await page.setViewportSize({ width: 1200, height: 700 })
  await expect(page.locator('.cm-editor')).toHaveCount(2)
  await expect(content(page)).toContainText('zzz')
  expect(await calls(page)).toEqual(['dirty:true'])
})

test('the original side of a diff takes no input', async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 700 })
  await open(page, 'diff-harness')
  const original = page.locator('.cm-content').first()
  await original.click()
  await page.keyboard.type('qqq')
  await expect(original).not.toContainText('qqq')
  expect(await calls(page)).toEqual([])
})

test('an editor that was detached and attached again keeps its scroll position', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1200, height: 300 })
  await open(page, 'harness')
  const scroller = page.locator('.cm-scroller')
  await scroller.evaluate((element) => (element.scrollTop = 400))
  await expect.poll(() => scroller.evaluate((e) => e.scrollTop)).toBe(400)
  const root = page.locator('[data-harness]')
  await root.evaluate((element) => {
    const parent = element.parentElement!
    element.remove()
    // Dockview hides a panel by detaching it from the document.
    setTimeout(() => parent.append(element), 100)
  })
  await expect.poll(() => scroller.evaluate((e) => e.scrollTop)).toBe(400)
  // It still works.
  await content(page).click()
  await page.keyboard.type('x')
  expect(await calls(page)).toEqual(['dirty:true'])
})

test('mod+S in the original side saves the editable text, and a new original is not an edit', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1200, height: 700 })
  await open(page, 'diff-harness')
  await page.evaluate(() =>
    (
      window as unknown as { editorProbe: { setOriginal: (t: string) => void } }
    ).editorProbe.setOriginal('only the original\n'),
  )
  await expect(page.locator('.cm-content').first()).toContainText(
    'only the original',
  )
  expect(await calls(page)).toEqual([])

  await page.locator('.cm-content').first().click()
  await page.keyboard.press(`${await mod(page)}+s`)
  const saved = (await calls(page)).find((call) => call.startsWith('save:'))
  expect(saved).toContain('export class JobQueue')
  expect(saved).not.toContain('only the original')
})

test('mod+Alt+U opens the collapsed regions of a diff', async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 700 })
  await open(page, 'diff-harness')
  const regions = page.locator('.cm-collapsedLines')
  await expect(regions.first()).toBeVisible()
  await content(page).focus()
  await page.keyboard.press(`${await mod(page)}+Alt+u`)
  await expect(regions).toHaveCount(0)
})

for (const width of [1200, 500]) {
  test(`a selection shows over a changed line (${width} px)`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 })
    await open(page, 'diff-harness')
    const line = page.locator('.cm-merge-b .cm-changedLine').first()
    await line.click()
    await page.keyboard.press('Home')
    await page.keyboard.press('Shift+End')
    const selection = await line.evaluate((element) => {
      const color = (value: string) => value
      return color(getComputedStyle(element, '::selection').backgroundColor)
    })
    // The selection is the opaque color of the token: not transparent.
    expect(selection).toBe('oklch(0.31 0.011 265)')
  })
}

const searchCount = (page: Page) =>
  page.locator('.cm-vv-search [aria-live="polite"]').first()

async function openSearch(page: Page, withReplace = false) {
  await content(page).click()
  await page.keyboard.press(`${await mod(page)}+f`)
  await expect(page.getByRole('textbox', { name: 'Find' })).toBeFocused()
  if (withReplace)
    await page.getByRole('button', { name: 'Show replace' }).click()
}

for (const [name, init] of [
  ['isComposing', { isComposing: true }],
  ['key code 229', { keyCode: 229 }],
] as const) {
  test(`a key of a composition in the search fields is not a command (${name})`, async ({
    page,
  }) => {
    await open(page, 'harness')
    await openSearch(page, true)
    const find = page.getByRole('textbox', { name: 'Find' })
    const replace = page.getByRole('textbox', { name: 'Replace' })
    await find.fill('MAX_ATTEMPTS')
    await replace.fill('LIMIT')
    const press = (field: typeof find, key: string) =>
      field.evaluate(
        (element, [eventKey, eventInit]) => {
          element.dispatchEvent(
            new KeyboardEvent('keydown', {
              key: eventKey as string,
              bubbles: true,
              cancelable: true,
              ...(eventInit as object),
            }),
          )
        },
        [key, init] as const,
      )
    // Enter confirms the composed text, and does not replace.
    await press(replace, 'Enter')
    await expect(content(page)).toContainText('const MAX_ATTEMPTS = 3')
    expect(await calls(page)).toEqual([])
    // Escape cancels the composition, and does not close the panel.
    await press(find, 'Escape')
    await expect(page.locator('.cm-vv-search')).toBeVisible()
    // The same keys without a composition work.
    // The first Enter selects the match, and the second replaces it.
    await replace.press('Enter')
    await replace.press('Enter')
    await expect(content(page)).toContainText('LIMIT')
  })
}

test('when the editor becomes read-only, the focus leaves the replace row for the find field', async ({
  page,
}) => {
  await open(page, 'harness')
  await openSearch(page, true)
  await page.getByRole('textbox', { name: 'Replace' }).focus()
  await probe(page, 'setReadOnly', true)
  await expect(page.getByRole('textbox', { name: 'Find' })).toBeFocused()
  await expect(page.getByRole('textbox', { name: 'Replace' })).toHaveCount(0)

  await probe(page, 'setReadOnly', false)
  await page.getByRole('button', { name: 'Show replace' }).focus()
  await probe(page, 'setReadOnly', true)
  await expect(page.getByRole('textbox', { name: 'Find' })).toBeFocused()
})

test('a regular expression that CodeMirror does not accept shows on the field', async ({
  page,
}) => {
  await open(page, 'harness')
  await openSearch(page)
  await page.getByRole('button', { name: 'Regular expression' }).click()
  const field = page.getByRole('textbox', { name: 'Find' })
  // Valid without the Unicode flag, and not valid with it.
  await field.fill('\\q')
  await expect(field).toHaveAttribute('aria-invalid', 'true')
  await expect(page.getByRole('alert')).toHaveCount(1)
})

test('each search panel has its own id for its error message', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1200, height: 800 })
  await open(page, 'diff-harness')
  for (const index of [0, 1]) {
    await page.locator('.cm-content').nth(index).click()
    await page.keyboard.press(`${await mod(page)}+f`)
    const panel = page.locator('.cm-vv-search').nth(index)
    await panel.getByRole('button', { name: 'Regular expression' }).click()
    await panel.getByRole('textbox', { name: 'Find' }).fill('(')
  }
  const ids = await page
    .locator('.cm-vv-search [aria-invalid="true"]')
    .evaluateAll((fields) =>
      fields.map((field) => field.getAttribute('aria-describedby')),
    )
  expect(ids).toHaveLength(2)
  expect(new Set(ids).size).toBe(2)
  for (const id of ids)
    await expect(page.locator(`[id="${id}"]`)).toHaveAttribute('role', 'alert')
})

test('a regular expression that matches the empty string gives a count and does not hang', async ({
  page,
}) => {
  await open(page, 'harness')
  await openSearch(page)
  await page.getByRole('button', { name: 'Regular expression' }).click()
  await page.getByRole('textbox', { name: 'Find' }).fill('x*')
  await expect(searchCount(page)).toHaveText(/^(\d+ of )?\d+\+?$/)
  await page.keyboard.press('Enter')
  await page.keyboard.press('Enter')
  await expect(searchCount(page)).toHaveText(/^\d+ of \d+\+?$/)
})

test('a large document with no match does not block the input, and the count follows the last query', async ({
  page,
}) => {
  await open(page, 'harness')
  const line = 'const value = compute(input, options) // a line of code\n'
  await setText(page, line.repeat(200_000), '2')
  await expect(content(page)).toContainText('const value')
  await openSearch(page)
  const field = page.getByRole('textbox', { name: 'Find' })
  await field.pressSequentially('zzzz', { delay: 10 })
  // The field takes the keys while a scan runs, and the count is of the last query.
  await expect(field).toHaveValue('zzzz')
  await expect(searchCount(page)).toHaveText('0', { timeout: 20_000 })
  await field.fill('value')
  await expect(searchCount(page)).toHaveText(/^\d+\+$/, { timeout: 20_000 })
  // A move of the selection does not scan again: the list of matches answers.
  await page.keyboard.press('Enter')
  await expect(searchCount(page)).toHaveText(/^\d+ of \d+\+$/)
})
