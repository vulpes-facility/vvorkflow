import { expect, test, type Page } from '@playwright/test'

// The behavior of the code editor and the diff editor.
const story = (id: string, args = '') =>
  `/iframe.html?id=screens-editor--${id}&viewMode=story&globals=a11y.manual:!true${args}`

const content = (page: Page) => page.locator('.cm-content').last()

async function open(page: Page, id: string, args = '') {
  await page.goto(story(id, args))
  await content(page).waitFor()
  await page.locator('.cm-line span[class]').first().waitFor()
}

/** The probe that `fixtures/editor-harness.tsx` puts on the page. */
interface Probe {
  calls: string[]
  setText: (text: string, version: string) => void
}
type ProbeWindow = { editorProbe?: Probe }

/**
 * The modifier of the shortcuts: the editor takes it from the platform of the
 * user agent, and the Safari user agent of WebKit says macOS also on Linux.
 */
const mod = (page: Page) =>
  page.evaluate(() => (/Mac/.test(navigator.userAgent) ? 'Meta' : 'Control'))

const calls = (page: Page) =>
  page.evaluate(
    () => (window as unknown as ProbeWindow).editorProbe?.calls ?? [],
  )

const setText = (page: Page, text: string, version: string) =>
  page.evaluate(
    ([next, nextVersion]) =>
      (window as unknown as ProbeWindow).editorProbe?.setText(
        next,
        nextVersion,
      ),
    [text, version],
  )

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

test('mod+S gives the content with the line endings of the file', async ({
  page,
}) => {
  await open(page, 'harness', '&args=path:scripts/build.ps1')
  await setText(page, 'a\r\nb\r\nc\r\n', '2')
  await expect(content(page)).toContainText('b')
  await content(page).click()
  await page.keyboard.press('ControlOrMeta+End')
  await page.keyboard.type('x')
  await page.keyboard.press(`${await mod(page)}+s`)
  const saved = (await calls(page)).find((call) => call.startsWith('save:'))
  expect(saved).toBe('save:a\r\nb\r\nc\r\nx')
})

test('a new version replaces the content and clears the dirty state', async ({
  page,
}) => {
  await open(page, 'harness')
  await content(page).click()
  await page.keyboard.type('x')
  expect(await calls(page)).toEqual(['dirty:true'])
  await setText(page, 'replaced\n', '2')
  await expect(content(page)).toHaveText('replaced')
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

test('mod+F opens the search, and a match has a fill and an outline', async ({
  page,
}) => {
  await open(page, 'harness')
  await content(page).click()
  await page.keyboard.press(`${await mod(page)}+f`)
  await expect(page.locator('.cm-search')).toBeVisible()
  await page.keyboard.type('job')
  await expect(page.locator('.cm-searchMatch').first()).toBeVisible()
  const outline = await page
    .locator('.cm-searchMatch')
    .first()
    .evaluate((element) => getComputedStyle(element).outlineStyle)
  expect(outline).toBe('solid')
  await page.keyboard.press('Escape')
  await expect(page.locator('.cm-search')).toBeHidden()
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
