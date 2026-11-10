import { expect, test, type Page } from '@playwright/test'
import {
  calls,
  content,
  mod,
  open,
  probe,
  redoKey,
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
  const before = await save(page)
  await probe(page, 'revert')
  await expect(content(page)).toHaveText('from the disk')
  await expect
    .poll(() => calls(page))
    .toEqual([
      'dirty:true',
      'conflict:true',
      `save:${before}`,
      'dirty:false',
      'conflict:false',
    ])
  // One undo gives the exact content before the revert, with the last keystroke.
  await content(page).click()
  await page.keyboard.press(`${await mod(page)}+z`)
  expect(await save(page)).toBe(before)
})

for (const story of ['harness', 'diff-harness']) {
  const pairs: [string, string, string][] = [
    ['CRLF content, LF disk', 'a\r\nb\r\nc\r\n', 'a\nb\nc\n'],
    ['LF content, CRLF disk', 'a\nb\nc\n', 'a\r\nb\r\nc\r\n'],
    ['mixed content, CRLF disk', 'a\r\nb\nc\r\nd', 'a\r\nb\r\nc\r\n'],
    ['CRLF content, mixed disk', 'a\r\nb\r\nc\r\n', 'a\r\nb\nc\r\nd'],
  ]
  for (const [name, mine, disk] of pairs) {
    test(`${story}: revert, undo, redo, and save keep the line breaks (${name})`, async ({
      page,
      browserName,
    }) => {
      await page.setViewportSize({ width: 1200, height: 700 })
      await open(page, story)
      await setText(page, mine, '2')
      await content(page).click()
      await page.keyboard.press('ControlOrMeta+Home')
      await page.keyboard.type('mine ')
      const before = await save(page)
      expect(before).toBe(`mine ${mine}`)
      // A disk update keeps the unsaved bytes, with their line breaks.
      await setText(page, disk, '3')
      await expect.poll(() => calls(page)).toContain('conflict:true')
      expect(await save(page)).toBe(before)

      await probe(page, 'revert')
      expect(await save(page)).toBe(disk)
      await content(page).click()
      await page.keyboard.press(`${await mod(page)}+z`)
      expect(await save(page)).toBe(before)
      // The redo key of macOS has a capital letter, which WebKit on Linux does
      // not send; the unit tests and Chromium cover the redo.
      if (browserName === 'webkit') return
      await page.keyboard.press(await redoKey(page))
      expect(await save(page)).toBe(disk)
    })
  }

  test(`${story}: a disk text with other line endings does not change unsaved bytes`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1200, height: 700 })
    await open(page, story)
    await setText(page, 'a\n', '2')
    await content(page).click()
    await page.keyboard.press(`${await mod(page)}+a`)
    await page.keyboard.type('b')
    await page.keyboard.press('Enter')
    expect(await save(page)).toBe('b\n')
    await setText(page, 'b\r\n', '3')
    await expect
      .poll(() => calls(page))
      .toEqual(expect.arrayContaining(['dirty:true', 'conflict:true']))
    expect(await save(page)).toBe('b\n')
  })
}

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

// A search replacement keeps the line breaks of the file, byte for byte.
for (const story of ['harness', 'diff-harness']) {
  const cases: {
    name: string
    file: string
    find: string
    replace: string
    regexp: boolean
    result: string
  }[] = [
    {
      name: 'a capture over two lines in a CRLF file',
      file: 'a\r\nb',
      find: '(a\\nb)',
      replace: '<$1>',
      regexp: true,
      result: '<a\r\nb>',
    },
    {
      name: 'an escaped newline in a CRLF file',
      file: 'a\r\nb\r\n',
      find: 'b',
      replace: 'x\\ny',
      regexp: false,
      result: 'a\r\nx\r\ny\r\n',
    },
    {
      name: 'an escaped CRLF in a CRLF file',
      file: 'a\r\nb\r\n',
      find: 'b',
      replace: 'x\\r\\ny',
      regexp: false,
      result: 'a\r\nx\r\ny\r\n',
    },
    {
      name: 'a capture over two lines in an LF file',
      file: 'a\nb\n',
      find: '(a\\nb)',
      replace: '<$1>',
      regexp: true,
      result: '<a\nb>\n',
    },
    {
      // A `\r` is an ordinary character in an LF file: the bytes are what the user wrote.
      name: 'an escaped CRLF in an LF file',
      file: 'a\nb\n',
      find: 'b',
      replace: 'x\\r\\ny',
      regexp: false,
      result: 'a\nx\r\ny\n',
    },
  ]
  for (const { name, file, find, replace, regexp, result } of cases) {
    for (const how of ['replace all button', 'Enter in the replace field']) {
      test(`${story}: ${name} (${how}), then undo and redo`, async ({
        page,
        browserName,
      }) => {
        await page.setViewportSize({ width: 1200, height: 700 })
        await open(page, story)
        await setText(page, file, '2')
        await content(page).click()
        await page.keyboard.press(`${await mod(page)}+f`)
        await page.getByRole('button', { name: 'Show replace' }).click()
        if (regexp)
          await page.getByRole('button', { name: 'Regular expression' }).click()
        await page.getByRole('textbox', { name: 'Find' }).fill(find)
        const field = page.getByRole('textbox', { name: 'Replace' })
        await field.fill(replace)
        if (how === 'replace all button')
          await page.getByRole('button', { name: 'Replace all' }).click()
        else {
          // The first Enter selects the match, and the second replaces it.
          await field.press('Enter')
          await field.press('Enter')
        }
        await content(page).click()
        expect(await save(page)).toBe(result)

        await page.keyboard.press(`${await mod(page)}+z`)
        expect(await save(page)).toBe(file)
        // The redo key of macOS has a capital letter, which WebKit on Linux does not send.
        if (browserName === 'webkit') return
        await page.keyboard.press(await redoKey(page))
        expect(await save(page)).toBe(result)
      })
    }
  }
}

// The commands that move text keep the bytes of a mixed text.
for (const story of ['harness', 'diff-harness']) {
  // A CRLF, an LF, and a CRLF again; the cursor goes to the line `b`, which has an LF.
  const mixed = 'a\r\nb\nc\r\nd'
  const commands: [string, (page: Page) => Promise<string>, string][] = [
    [
      'move a line up (Alt+ArrowUp)',
      async () => 'Alt+ArrowUp',
      'b\na\r\nc\r\nd',
    ],
    [
      'move a line down (Alt+ArrowDown)',
      async () => 'Alt+ArrowDown',
      'a\r\nc\r\nb\nd',
    ],
    [
      'copy a line up (Shift+Alt+ArrowUp)',
      async () => 'Shift+Alt+ArrowUp',
      'a\r\nb\nb\nc\r\nd',
    ],
    [
      'copy a line down (Shift+Alt+ArrowDown)',
      async () => 'Shift+Alt+ArrowDown',
      'a\r\nb\nb\nc\r\nd',
    ],
    [
      'delete a line (mod+Shift+K)',
      async (page) => `${await mod(page)}+Shift+k`,
      'a\r\nc\r\nd',
    ],
    ['indent a line (Tab)', async () => 'Tab', 'a\r\n  b\nc\r\nd'],
  ]
  for (const [name, key, result] of commands) {
    test(`${story}: ${name} keeps the bytes of a mixed text, with undo and redo`, async ({
      page,
      browserName,
    }) => {
      await page.setViewportSize({ width: 1200, height: 700 })
      await open(page, story)
      await setText(page, mixed, '2')
      await content(page).click()
      await page.keyboard.press('ControlOrMeta+Home')
      await page.keyboard.press('ArrowDown')
      await page.keyboard.press(await key(page))
      expect(await save(page)).toBe(result)
      await page.keyboard.press(`${await mod(page)}+z`)
      expect(await save(page)).toBe(mixed)
      // The redo key of macOS has a capital letter, which WebKit on Linux does not send.
      if (browserName === 'webkit') return
      await page.keyboard.press(await redoKey(page))
      expect(await save(page)).toBe(result)
    })
  }
}

test('the history stays when the saved text comes back, and the same text comes again', async ({
  page,
}) => {
  await open(page, 'harness')
  // The content before the typing: the text of the disk.
  await setText(page, 'a\nb\n', '0')
  await content(page).click()
  await page.keyboard.press(`${await mod(page)}+End`)
  await page.keyboard.type('x')
  const saved = (await save(page)) ?? ''
  await setText(page, saved, '2')
  await setText(page, saved, '3')
  await expect
    .poll(() => calls(page))
    .toEqual(['dirty:true', `save:${saved}`, 'dirty:false'])
  await content(page).click()
  await page.keyboard.press(`${await mod(page)}+z`)
  await expect
    .poll(() => calls(page))
    .toEqual(['dirty:true', `save:${saved}`, 'dirty:false', 'dirty:true'])
  expect(await save(page)).toBe('a\nb\n')
})

test('a join of two lines of a CRLF file is undone after the saved text comes twice', async ({
  page,
}) => {
  await open(page, 'harness')
  await setText(page, 'a\r\nb', '2')
  await content(page).click()
  await page.keyboard.press('ControlOrMeta+Home')
  await page.keyboard.press('End')
  await page.keyboard.press('Delete')
  expect(await save(page)).toBe('ab')
  // The answer of the save, and the same text once more.
  await setText(page, 'ab', '3')
  await setText(page, 'ab', '4')
  await expect.poll(() => calls(page)).toContain('dirty:false')
  await page.keyboard.press(`${await mod(page)}+z`)
  expect(await save(page)).toBe('a\r\nb')
})

test('a clean text with no line break keeps the separator of the document', async ({
  page,
}) => {
  await open(page, 'harness')
  await setText(page, 'a\r\nb', '2')
  await expect(content(page)).toHaveText('ab')
  await setText(page, 'xyz', '3')
  await expect(content(page)).toHaveText('xyz')
  await content(page).click()
  await page.keyboard.press('ControlOrMeta+Home')
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('Enter')
  // The language can indent the new line, so the line break is what counts.
  const saved = (await save(page)) ?? ''
  expect(saved).toMatch(/^x\r\n\s*yz$/)
  expect(saved).not.toMatch(/(?<!\r)\n/)
})
