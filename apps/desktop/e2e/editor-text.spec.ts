import { expect, test, type Page } from '@playwright/test'
import {
  calls,
  content,
  mod,
  open,
  probe,
  save,
  setText,
} from './editor-helpers.js'

// The text contract of the editors: the line breaks, and a new text from the disk.

/** Sends the events that an IME sends at the start of a composition. */
const startComposition = (page: Page) =>
  content(page).evaluate((element) => {
    element.dispatchEvent(
      new CompositionEvent('compositionstart', { bubbles: true, data: '' }),
    )
  })

/** Sends the events that an IME sends at the end of a composition. */
const endComposition = (page: Page) =>
  content(page).evaluate((element) => {
    element.dispatchEvent(
      new CompositionEvent('compositionend', { bubbles: true, data: '' }),
    )
  })

const texts: [string, string][] = [
  ['LF', 'a\nb\nc\n'],
  ['CRLF', 'a\r\nb\r\nc\r\n'],
  ['mixed endings', 'a\r\nb\nc\r\nd\n'],
  ['a lone CR', 'a\rb\rc\r'],
  ['LF with no final line ending', 'a\nb'],
  ['CRLF with no final line ending', 'a\r\nb'],
  ['an empty line at the end', 'a\r\n\r\n'],
]

for (const [name, text] of texts) {
  test(`mod+S saves ${name} byte for byte, also with a typed character`, async ({
    page,
  }) => {
    await open(page, 'harness')
    await setText(page, text, '2')
    await expect(content(page)).toContainText('a')
    expect(await save(page)).toBe(text)
    // The text did not change, so it is not dirty.
    expect(await calls(page)).not.toContain('dirty:true')

    await content(page).click()
    await page.keyboard.press('ControlOrMeta+Home')
    await page.keyboard.type('x')
    expect(await save(page)).toBe(`x${text}`)
  })
}

test('a new line gets the separator of the file: CRLF in a CRLF file, LF in a mixed one', async ({
  page,
}) => {
  await open(page, 'harness')
  await setText(page, 'a\r\nb', '2')
  await content(page).click()
  await page.keyboard.press('ControlOrMeta+End')
  await page.keyboard.press('Enter')
  await page.keyboard.type('c')
  expect(await save(page)).toBe('a\r\nb\r\nc')

  await setText(page, 'a\r\nb\nc', '3')
  await expect(content(page)).toContainText('c')
  // The edit above was saved by the owner: the new text is the disk text.
  await probe(page, 'revert')
  await content(page).click()
  await page.keyboard.press('ControlOrMeta+End')
  await page.keyboard.press('Enter')
  await page.keyboard.type('d')
  expect(await save(page)).toBe('a\r\nb\nc\nd')
})

test('a pasted text gets the line breaks of the file', async ({ page }) => {
  const paste = (data: string) =>
    content(page).evaluate((element, text) => {
      const clipboardData = new DataTransfer()
      clipboardData.setData('text/plain', text)
      element.dispatchEvent(
        new ClipboardEvent('paste', {
          clipboardData,
          bubbles: true,
          cancelable: true,
        }),
      )
    }, data)
  await open(page, 'harness')
  await setText(page, 'a\nb', '2')
  await content(page).click()
  await page.keyboard.press('ControlOrMeta+End')
  await paste('p\r\nq')
  expect(await save(page)).toBe('a\nbp\nq')

  await setText(page, 'a\r\nb', '3')
  await probe(page, 'revert')
  await content(page).click()
  await page.keyboard.press('ControlOrMeta+End')
  await paste('p\nq')
  expect(await save(page)).toBe('a\r\nbp\r\nq')
})

test('a new text with another line ending replaces the content and gives it back with that ending', async ({
  page,
}) => {
  await open(page, 'harness')
  await setText(page, 'a\r\nb\r\n', '2')
  await expect(content(page)).toContainText('b')
  expect(await save(page)).toBe('a\r\nb\r\n')
  await setText(page, 'a\nb\nc\n', '3')
  await expect(content(page)).toContainText('c')
  expect(await save(page)).toBe('a\nb\nc\n')
  // A revert to a text with another ending also changes the ending.
  await setText(page, 'z\r\n', '4')
  await expect(content(page)).toContainText('z')
  expect(await save(page)).toBe('z\r\n')
})

test('a new version replaces the content while it has no unsaved edits', async ({
  page,
}) => {
  await open(page, 'harness')
  await setText(page, 'replaced\n', '2')
  await expect(content(page)).toHaveText('replaced')
  await expect.poll(() => calls(page)).toEqual([])
})

test('a new version while the content has unsaved edits keeps the edits and tells the conflict', async ({
  page,
}) => {
  await open(page, 'harness')
  await content(page).click()
  await page.keyboard.press('ControlOrMeta+Home')
  await page.keyboard.type('mine ')
  await expect.poll(() => calls(page)).toEqual(['dirty:true'])
  await setText(page, 'from the disk\n', '2')
  await expect(content(page)).toContainText('mine import')
  await expect(content(page)).not.toContainText('from the disk')
  await expect.poll(() => calls(page)).toEqual(['dirty:true', 'conflict:true'])

  // The next save has the edits; the dirty state compares with the new text.
  expect(await save(page)).toContain('mine import')
})

test('a new version that equals the content clears the dirty state, and is no conflict', async ({
  page,
}) => {
  await open(page, 'harness')
  await content(page).click()
  await page.keyboard.press('ControlOrMeta+End')
  await page.keyboard.type('x')
  const saved = await save(page)
  await expect.poll(() => calls(page)).toEqual(['dirty:true', `save:${saved}`])
  await setText(page, saved ?? '', '2')
  await expect
    .poll(() => calls(page))
    .toEqual(['dirty:true', `save:${saved}`, 'dirty:false'])
})

test('typing after a save, and then the saved version, is a conflict until the content is equal', async ({
  page,
}) => {
  await open(page, 'harness')
  await content(page).click()
  await page.keyboard.press('ControlOrMeta+End')
  await page.keyboard.type('x')
  const saved = (await save(page)) ?? ''
  await page.keyboard.type('y')
  // The save came back with a new version, after more typing.
  await setText(page, saved, '2')
  await expect
    .poll(() => calls(page))
    .toEqual(['dirty:true', `save:${saved}`, 'conflict:true'])
  // The content is equal to the disk text again: the conflict ends.
  await page.keyboard.press('Backspace')
  await expect
    .poll(() => calls(page))
    .toEqual([
      'dirty:true',
      `save:${saved}`,
      'conflict:true',
      'dirty:false',
      'conflict:false',
    ])
})

test('revert() replaces the content with the last text, and ends the conflict', async ({
  page,
}) => {
  await open(page, 'harness')
  await content(page).click()
  await page.keyboard.type('mine ')
  await setText(page, 'from the disk\n', '2')
  await expect.poll(() => calls(page)).toEqual(['dirty:true', 'conflict:true'])
  // A revert within half a second of a keystroke joins its undo group.
  await page.waitForTimeout(700)
  await probe(page, 'revert')
  await expect(content(page)).toHaveText('from the disk')
  await expect
    .poll(() => calls(page))
    .toEqual(['dirty:true', 'conflict:true', 'dirty:false', 'conflict:false'])
  // The revert is in the undo history.
  await content(page).click()
  await page.keyboard.press('ControlOrMeta+z')
  await expect(content(page)).toContainText('mine')
})

test('a new version during a composition keeps the content, and is not applied later', async ({
  page,
}) => {
  await open(page, 'harness')
  await content(page).click()
  await startComposition(page)
  await setText(page, 'from the disk\n', '2')
  await expect(content(page)).toContainText('import { EventEmitter }')
  await expect.poll(() => calls(page)).toEqual(['dirty:true', 'conflict:true'])
  await endComposition(page)
  await page.waitForTimeout(200)
  await expect(content(page)).toContainText('import { EventEmitter }')
  await expect(content(page)).not.toContainText('from the disk')
})

test('a real composition keeps the text that it commits, when a new version comes', async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', 'Only Chromium has an IME command.')
  await open(page, 'harness')
  await content(page).click()
  await page.keyboard.press('ControlOrMeta+Home')
  const client = await page.context().newCDPSession(page)
  await client.send('Input.imeSetComposition', {
    text: 'あ',
    selectionStart: 1,
    selectionEnd: 1,
  })
  await setText(page, 'from the disk\n', '2')
  await client.send('Input.insertText', { text: 'あ' })
  await expect(content(page)).toContainText('あimport')
  await expect(content(page)).not.toContainText('from the disk')
  await expect.poll(() => calls(page)).toContain('conflict:true')
})

test('mod+S during a composition does not save, and saves after it', async ({
  page,
}) => {
  await open(page, 'harness')
  await content(page).click()
  await startComposition(page)
  await page.keyboard.press(`${await mod(page)}+s`)
  await expect.poll(() => calls(page)).toEqual([])
  await endComposition(page)
  await page.waitForTimeout(200)
  expect(await save(page)).toContain('import { EventEmitter }')
})
