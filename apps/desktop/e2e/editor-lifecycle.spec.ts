import { expect, test, type Page } from '@playwright/test'
import { calls, content, mod, open, probe } from './editor-helpers.js'

// How the editors live: a platform change, a layout switch, a mount, and a path.

const isMacAgent = (page: Page) =>
  page.evaluate(() => /Mac/.test(navigator.userAgent))

test('a platform change keeps the content, the history, the focus, and the open search', async ({
  page,
}) => {
  await open(page, 'harness')
  await content(page).click()
  await page.keyboard.press('ControlOrMeta+Home')
  await page.keyboard.type('mine ')
  await page.keyboard.press(`${await mod(page)}+f`)
  await page.keyboard.type('job')
  await expect(page.locator('.cm-vv-search')).toBeVisible()
  await content(page).click()

  const other = (await isMacAgent(page)) ? 'linux' : 'macos'
  await probe(page, 'setPlatform', other)
  await expect(content(page)).toContainText('mine import')
  await expect(page.locator('.cm-vv-search')).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Find' })).toHaveValue('job')
  expect(await calls(page)).toEqual(['dirty:true'])
  // The focus stays in the content, and the cursor is where it was.
  await expect(content(page)).toBeFocused()
  // The history stays, with the keys of the new platform.
  const modifier = other === 'macos' ? 'Meta' : 'Control'
  await page.keyboard.press(`${modifier}+z`)
  await expect(content(page)).not.toContainText('mine import')
})

test('a platform prop that differs from the user agent decides the keys', async ({
  page,
}) => {
  const mac = await isMacAgent(page)
  // The prop is the platform that the user agent does not say.
  await open(page, 'harness', `&args=platform:${mac ? 'linux' : 'macos'}`)
  await content(page).click()
  const ours = mac ? 'Control' : 'Meta'
  const theirs = mac ? 'Meta' : 'Control'
  await page.keyboard.press(`${theirs}+s`)
  expect(
    (await calls(page)).filter((call) => call.startsWith('save:')),
  ).toEqual([])
  await page.keyboard.press(`${ours}+s`)
  await expect
    .poll(async () =>
      (await calls(page)).filter((call) => call.startsWith('save:')),
    )
    .toHaveLength(1)
})

test('a platform change and a new version in the same render do not lose the text', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1200, height: 700 })
  await open(page, 'diff-harness')
  const other = (await isMacAgent(page)) ? 'linux' : 'macos'
  await page.evaluate((platform) => {
    const probeObject = (
      window as unknown as {
        editorProbe: {
          setPlatform: (p: string) => void
          setText: (t: string, v: string) => void
        }
      }
    ).editorProbe
    probeObject.setPlatform(platform)
    probeObject.setText('from the disk\n', '2')
  }, other)
  await expect(content(page)).toHaveText('from the disk')
  await expect(page.locator('.cm-editor')).toHaveCount(2)
})

/**
 * Puts the cursor at the start of a changed line, which shows in both layouts.
 * The start of the document is in a collapsed region of a diff.
 */
async function cursorAtChangedLine(page: Page) {
  await page
    .locator('.cm-merge-b .cm-changedLine', { hasText: '250' })
    .first()
    .click()
  await page.keyboard.press('Home')
}

/** Changes the width of the harness, as a panel of the window does. */
const setWidth = (page: Page, width: number) =>
  page.evaluate((value) => {
    document.querySelector<HTMLElement>('[data-harness]')!.style.width =
      `${value}px`
  }, width)

test('a layout switch keeps the cursor, the focus, and the text, and a new version in it is applied', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1200, height: 700 })
  await open(page, 'diff-harness')
  await cursorAtChangedLine(page)
  await page.keyboard.type('mine ')
  await setWidth(page, 500)
  await expect(page.locator('.cm-editor')).toHaveCount(1)
  // The focus is in the new editor, and the cursor is after the typed text.
  await expect(content(page)).toBeFocused()
  await page.keyboard.type('Q')
  await expect(content(page)).toContainText('mine Qconst')
  expect(await calls(page)).toEqual(['dirty:true'])

  // A version that comes with the next switch is not lost.
  await page.evaluate(() => {
    document.querySelector<HTMLElement>('[data-harness]')!.style.width =
      '1000px'
    ;(
      window as unknown as {
        editorProbe: { setText: (t: string, v: string) => void }
      }
    ).editorProbe.setText('from the disk\n', '2')
  })
  await expect(page.locator('.cm-editor')).toHaveCount(2)
  // The edits are kept, and the conflict is told.
  await expect(content(page)).toContainText('mine Qconst')
  await expect.poll(() => calls(page)).toContain('conflict:true')
})

test('a layout switch does not take the focus from another control', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1200, height: 700 })
  await open(page, 'diff-harness')
  const next = page.getByRole('button', { name: 'Next control' })
  await next.focus()
  await setWidth(page, 500)
  await expect(page.locator('.cm-editor')).toHaveCount(1)
  await expect(next).toBeFocused()
})

test('a layout switch with the search open keeps the focus where it was', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1200, height: 700 })
  await open(page, 'diff-harness')
  await content(page).click()
  await page.keyboard.press(`${await mod(page)}+f`)
  await page.keyboard.type('job')
  const next = page.getByRole('button', { name: 'Next control' })
  await next.focus()
  await setWidth(page, 500)
  await expect(page.locator('.cm-editor')).toHaveCount(1)
  // The panel is back with its query, and the focus stayed outside.
  await expect(page.getByRole('textbox', { name: 'Find' })).toHaveValue('job')
  await expect(next).toBeFocused()
  await setWidth(page, 1000)
  await expect(page.locator('.cm-editor')).toHaveCount(2)
  await expect(next).toBeFocused()
})

test('a layout switch keeps an open search and its query', async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 700 })
  await open(page, 'diff-harness')
  await content(page).click()
  await page.keyboard.press(`${await mod(page)}+f`)
  await page.keyboard.type('job')
  await setWidth(page, 500)
  await expect(page.locator('.cm-editor')).toHaveCount(1)
  await expect(page.getByRole('textbox', { name: 'Find' })).toHaveValue('job')
  await expect(page.getByRole('textbox', { name: 'Find' })).toBeFocused()
})

test('a layout switch waits for the end of a composition, and keeps the text that it commits', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1200, height: 700 })
  await open(page, 'diff-harness')
  await content(page).click()
  await page.keyboard.press('ControlOrMeta+Home')
  await content(page).evaluate((element) => {
    element.dispatchEvent(
      new CompositionEvent('compositionstart', { bubbles: true, data: '' }),
    )
  })
  await setWidth(page, 500)
  await page.waitForTimeout(400)
  // Not rebuilt during the composition.
  await expect(page.locator('.cm-editor')).toHaveCount(2)
  await content(page).evaluate((element) => {
    element.dispatchEvent(
      new CompositionEvent('compositionend', { bubbles: true, data: '' }),
    )
  })
  await expect(page.locator('.cm-editor')).toHaveCount(1)
})

test('a real composition survives a layout switch with its committed text', async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', 'Only Chromium has an IME command.')
  await page.setViewportSize({ width: 1200, height: 700 })
  await open(page, 'diff-harness')
  await cursorAtChangedLine(page)
  const client = await page.context().newCDPSession(page)
  await client.send('Input.imeSetComposition', {
    text: 'あ',
    selectionStart: 1,
    selectionEnd: 1,
  })
  await setWidth(page, 500)
  await page.waitForTimeout(300)
  await expect(page.locator('.cm-editor')).toHaveCount(2)
  await client.send('Input.insertText', { text: 'あ' })
  await expect(page.locator('.cm-editor')).toHaveCount(1)
  await expect(content(page)).toContainText('あconst')
})

test('a mount, an unmount, and a mount leave one editor, and its callbacks fire once', async ({
  page,
}) => {
  await open(page, 'harness')
  await expect(page.locator('.cm-editor')).toHaveCount(1)
  await probe(page, 'setMounted', false)
  await expect(page.locator('.cm-editor')).toHaveCount(0)
  await probe(page, 'setMounted', true)
  await expect(page.locator('.cm-editor')).toHaveCount(1)
  await content(page).click()
  await page.keyboard.type('xy')
  await page.keyboard.press(`${await mod(page)}+f`)
  await expect(page.locator('.cm-vv-search')).toHaveCount(1)
  expect(await calls(page)).toEqual(['dirty:true'])
  await probe(page, 'setMounted', false)
  await expect(page.locator('.cm-vv-search')).toHaveCount(0)
})

test('the editor in strict mode has one view and fires its callbacks once', async ({
  page,
}) => {
  await open(page, 'strict-harness')
  await expect(page.locator('.cm-editor')).toHaveCount(1)
  await content(page).click()
  await page.keyboard.type('x')
  expect(await calls(page)).toEqual(['dirty:true'])
})

test('a callback that is replaced is the one that is called', async ({
  page,
}) => {
  await open(page, 'harness')
  await probe(page, 'swapCallbacks')
  await content(page).click()
  await page.keyboard.type('x')
  await expect.poll(() => calls(page)).toEqual(['b:dirty:true'])
  await page.keyboard.press(`${await mod(page)}+s`)
  await expect
    .poll(async () => (await calls(page)).at(-1))
    .toMatch(/^b:save:.*x/s)
})

/** The computed colors of the first spans of the first line. */
const firstLineColors = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('.cm-line')[0].querySelectorAll('span')].map(
      (span) => getComputedStyle(span).color,
    ),
  )

test('a language that loads late does not replace the language of the path that came after', async ({
  page,
}) => {
  await open(page, 'harness')
  const before = await firstLineColors(page)
  expect(new Set(before).size).toBeGreaterThan(1)

  // Hold each script that loads from now on: they are the lazy languages.
  const held: (() => void)[] = []
  await page.route('**/*.js', async (route) => {
    await new Promise<void>((resolve) => held.push(resolve))
    await route.continue()
  })
  await probe(page, 'setPath', 'docs/readme.md')
  await page.waitForTimeout(300)
  // The path goes back to a language that is loaded.
  await probe(page, 'setPath', 'src/queue/job-queue.ts')
  await page.waitForTimeout(300)
  for (const release of held) release()
  await page.waitForTimeout(500)
  expect(await firstLineColors(page)).toEqual(before)
})
