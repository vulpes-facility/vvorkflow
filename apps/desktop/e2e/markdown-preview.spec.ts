import { expect, test, type Page } from '@playwright/test'

const story = (name: string) =>
  `/iframe.html?id=screens-markdownpreview--${name}&viewMode=story&globals=a11y.manual:!true`

/** A 1 by 1 PNG, for the answer of the fake remote host. */
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64',
)

/** Counts the requests to the fake remote host, by path. The host answers with a PNG. */
async function countRemoteRequests(page: Page) {
  const paths: string[] = []
  await page.route(/remote-images\.test/, (route) => {
    paths.push(new URL(route.request().url()).pathname)
    return route.fulfill({ contentType: 'image/png', body: png })
  })
  return paths
}

/** Gives the story new args, as the host of the preview would. */
async function update(page: Page, name: string, args: Record<string, unknown>) {
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
    { storyId: `screens-markdownpreview--${name}`, args },
  )
}

const region = (page: Page) =>
  page.getByRole('region', { name: 'Markdown preview' })

test.describe('security', () => {
  test('a remote image makes no request while remoteImages is false', async ({
    page,
  }) => {
    const requests = await countRemoteRequests(page)
    await page.goto(story('hostile'))
    await region(page).waitFor()
    await page.waitForLoadState('networkidle')
    // The inline, the reference-style, and the protocol-relative image, and
    // the raw <img> of the document: none of them makes a request. The raw
    // <img> is removed. Capitals are a remote image too. The forms that only a
    // decode makes remote (a leading space and backslashes), and the form with
    // two readings (`https:name.png`), are blocked.
    await page.waitForTimeout(500)
    expect(requests).toEqual([])
    // Each blocked image is a placeholder with its host.
    await expect(
      region(page).getByRole('img', { name: /remote-images\.test/ }),
    ).toHaveCount(5)
  })

  test('the same images load when remoteImages is true (the counter works)', async ({
    page,
  }) => {
    const requests = await countRemoteRequests(page)
    await page.goto(story('hostile'))
    await region(page).waitFor()
    await update(page, 'hostile', { remoteImages: true })
    // An image under the fold is lazy.
    await region(page).evaluate((element) => element.scrollTo(0, 1e6))
    await expect
      .poll(() => [...new Set(requests)].sort())
      .toEqual([
        '/dragged.png',
        '/inline.png',
        '/reference.png',
        '/relative.png',
        '/upper.png',
      ])
    // The raw <img> of the document never loads, also when images are allowed.
    expect(requests).not.toContain('/raw.png')
    expect(requests).not.toContain('/same-scheme.png')
    // Forms that only a decode makes remote are blocked, and make no request.
    expect(requests).not.toContain('/space.png')
    expect(requests).not.toContain('/bs.png')
  })

  test('raw HTML, scripts, frames, styles, and event handlers have no effect', async ({
    page,
  }) => {
    const errors: string[] = []
    page.on('dialog', (dialog) => {
      errors.push(dialog.message())
      return dialog.dismiss()
    })
    await countRemoteRequests(page)
    await page.goto(story('hostile'))
    await region(page).waitFor()
    expect(
      await region(page)
        .locator('script, iframe, style, object, embed')
        .count(),
    ).toBe(0)
    expect(
      await page.evaluate(() => 'x' in window && '__pwned' in window),
    ).toBe(false)
    expect(
      await page.evaluate(
        () => (window as never as { __pwned?: string }).__pwned,
      ),
    ).toBeUndefined()
    // The `<style>` of the document did not hide the page.
    await expect(region(page).getByRole('heading', { level: 1 })).toBeVisible()
    // The tags are gone, and they are not shown as text.
    await expect(region(page)).not.toContainText('<script>')
    expect(errors).toEqual([])
  })

  test('an unsafe link is plain text, and an unsafe image never loads', async ({
    page,
  }) => {
    await countRemoteRequests(page)
    await page.goto(story('hostile'))
    await region(page).waitFor()
    // The obfuscated forms of the scheme are plain text too: a tab in the
    // scheme, capitals, and a leading space.
    for (const name of [
      'javascript link',
      'vbscript link',
      'data link',
      'tab link',
      'upper link',
      'space link',
    ]) {
      await expect(region(page).getByRole('link', { name })).toHaveCount(0)
      await expect(region(page)).toContainText(name)
    }
    // Only the two safe links are links.
    await expect(region(page).getByRole('link')).toHaveCount(2)
    expect(
      await page.evaluate(
        () => (window as never as { __pwned?: string }).__pwned,
      ),
    ).toBeUndefined()
    // No element of the preview has a `javascript:` or `data:` URL.
    expect(
      await region(page).evaluate((root) =>
        [...root.querySelectorAll('[href], [src]')]
          .map(
            (element) =>
              element.getAttribute('href') ?? element.getAttribute('src') ?? '',
          )
          .filter((url) => /^\s*(javascript|vbscript|data):/i.test(url)),
      ),
    ).toEqual([])
    await expect(region(page).getByRole('img', { name: 'data:' })).toBeVisible()
    await expect(
      region(page)
        .getByRole('img', { name: /javascript:/ })
        .first(),
    ).toBeVisible()
    for (const name of ['space (https:)', 'backslash (https:)'])
      await expect(region(page).getByRole('img', { name })).toBeVisible()
    // `https:name.png` has two readings: it is blocked, and makes no request.
    await expect(
      region(page).getByRole('img', { name: 'same scheme (https:)' }),
    ).toBeVisible()
  })

  test('a link has no destination for the browser: no navigation, no popup, no request', async ({
    page,
  }) => {
    const popups: string[] = []
    page.context().on('page', (popup) => popups.push(popup.url()))
    const navigations: string[] = []
    page.on('framenavigated', (frame) => navigations.push(frame.url()))
    const targetRequests: string[] = []
    await page.route(/link-target\.test/, (route) => {
      targetRequests.push(route.request().url())
      return route.fulfill({ contentType: 'text/html', body: 'page' })
    })
    await countRemoteRequests(page)
    await page.goto(story('hostile'))
    await region(page).waitFor()
    const url = page.url()
    const navigationsBefore = navigations.length

    // No element has a destination that the browser can follow.
    expect(await region(page).locator('a[href]').count()).toBe(0)
    expect(
      await region(page).evaluate((root) =>
        [...root.querySelectorAll<HTMLElement>('a, img')].every(
          (element) => element.draggable === false,
        ),
      ),
    ).toBe(true)

    const link = region(page).getByRole('link', { name: 'drag me' })
    await link.scrollIntoViewIfNeeded()
    await link.click()
    await link.click({ modifiers: ['Control'] })
    await link.click({ modifiers: ['Meta'] })
    await link.click({ modifiers: ['Shift'] })
    await link.click({ button: 'middle' })
    await link.focus()
    await page.keyboard.press('Enter')
    // A drag and drop of the link onto the page.
    await link.dragTo(region(page).getByRole('heading', { level: 1 }))
    await link.dragTo(page.locator('body'), { targetPosition: { x: 4, y: 4 } })
    await page.waitForTimeout(300)

    expect(popups).toEqual([])
    expect(page.url()).toBe(url)
    expect(navigations.length).toBe(navigationsBefore)
    expect(targetRequests).toEqual([])
    // The click, the three clicks with a modifier, and Enter activate the
    // link: the host decides. The middle click and the drag do not.
    expect(
      (
        await page.evaluate(
          () =>
            (globalThis as unknown as { openedLinks?: string[] }).openedLinks,
        )
      )?.filter((opened) => opened.includes('link-target.test')),
    ).toHaveLength(5)
  })

  test('a loaded image cannot be dragged out to navigate the window', async ({
    page,
  }) => {
    const popups: string[] = []
    page.context().on('page', (popup) => popups.push(popup.url()))
    const requests = await countRemoteRequests(page)
    await page.goto(story('hostile'))
    await region(page).waitFor()
    await update(page, 'hostile', { remoteImages: true })
    await region(page).evaluate((element) => element.scrollTo(0, 1e6))
    const image = region(page).getByRole('img', { name: 'dragged' })
    await expect(image).toBeVisible()
    await expect
      .poll(() => requests.filter((p) => p === '/dragged.png').length)
      .toBe(1)
    const url = page.url()
    await image.dragTo(region(page).getByRole('heading', { level: 1 }))
    await image.dragTo(page.locator('body'), { targetPosition: { x: 4, y: 4 } })
    await page.waitForTimeout(300)
    expect(popups).toEqual([])
    expect(page.url()).toBe(url)
    // No second request: the window did not open the image.
    expect(requests.filter((p) => p === '/dragged.png')).toHaveLength(1)
  })

  test('a link opens with the keyboard, and the safe link calls onOpenLink', async ({
    page,
  }) => {
    await page.goto(story('hostile'))
    await region(page).waitFor()
    const link = region(page).getByRole('link', { name: 'safe link' })
    // The link is in the tab order.
    await link.focus()
    await expect(link).toBeFocused()
    await page.keyboard.press('Enter')
    expect(
      (
        await page.evaluate(
          () =>
            (globalThis as unknown as { openedLinks?: string[] }).openedLinks,
        )
      )?.includes('https://example.com/safe'),
    ).toBe(true)
  })

  test('a link has a menu to copy its address: right click, Shift+F10, and the Menu key', async ({
    page,
    browserName,
  }) => {
    // The clipboard of WebKit is not readable in Playwright: stub the write.
    if (browserName === 'chromium')
      await page
        .context()
        .grantPermissions(['clipboard-read', 'clipboard-write'])
    else
      await page.addInitScript(() => {
        const copied: string[] = []
        ;(window as never as { copied: string[] }).copied = copied
        Object.defineProperty(navigator, 'clipboard', {
          value: { writeText: async (text: string) => void copied.push(text) },
        })
      })
    await page.goto(story('hostile'))
    await region(page).waitFor()
    const link = region(page).getByRole('link', { name: 'drag me' })
    await link.scrollIntoViewIfNeeded()
    // The destination is not in a native attribute that the browser reads.
    expect(await link.getAttribute('title')).toBeNull()
    expect(await link.getAttribute('href')).toBeNull()
    // The link text can still be selected.
    expect(
      await link.evaluate((element) => {
        const style = getComputedStyle(element)
        return style.userSelect === 'none' || style.webkitUserSelect === 'none'
      }),
    ).toBe(false)

    const copied = () =>
      browserName === 'chromium'
        ? page.evaluate(() => navigator.clipboard.readText())
        : page.evaluate(() =>
            (window as never as { copied: string[] }).copied.at(-1),
          )
    const item = page.getByRole('menuitem', { name: 'Copy link address' })

    for (const open of [
      () => link.click({ button: 'right' }),
      async () => {
        await link.focus()
        await page.keyboard.press('Shift+F10')
      },
      async () => {
        await link.focus()
        await page.keyboard.press('ContextMenu')
      },
    ]) {
      await open()
      await expect(item).toBeVisible()
      await item.click()
      await expect(item).toHaveCount(0)
      expect(await copied()).toBe('https://link-target.test/page')
      // The focus comes back to the link.
      await expect(link).toBeFocused()
      await page.evaluate(() =>
        navigator.clipboard.writeText?.('x').catch(() => {}),
      )
    }
    // The keyboard picks the item too: Enter, and Escape closes the menu.
    await link.focus()
    await page.keyboard.press('Shift+F10')
    await expect(item).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(item).toHaveCount(0)
    await expect(link).toBeFocused()
  })

  test('two previews on one page do not share an id, and a footnote moves only its own preview', async ({
    page,
  }) => {
    await page.goto(story('two-previews'))
    await region(page).first().waitFor()
    const duplicates = await page.evaluate(() => {
      const seen = new Map<string, number>()
      for (const element of document.querySelectorAll('[id]'))
        seen.set(element.id, (seen.get(element.id) ?? 0) + 1)
      return [...seen].filter(([, count]) => count > 1).map(([id]) => id)
    })
    expect(duplicates).toEqual([])

    const [first, second] = [region(page).nth(0), region(page).nth(1)]
    await first.locator('a[data-footnote-ref]').first().click()
    await expect(first.locator(':focus')).toHaveCount(1)
    expect(await second.locator(':focus').count()).toBe(0)
    expect(await second.evaluate((element) => element.scrollTop)).toBe(0)
    expect(
      await first.evaluate((element) => element.scrollTop),
    ).toBeGreaterThan(0)
    // The note that has the label of the section is its own note.
    await second.locator('a[data-footnote-ref]').nth(1).click()
    await expect(second.locator(':focus')).toHaveCount(1)
    expect(await first.locator(':focus').count()).toBe(0)
    // The reference of a label that looks like an id finds its own note.
    const noteId = await second.locator(':focus').getAttribute('id')
    expect(noteId).toMatch(/fn-user-content-fn-1$/)
  })

  test('an image that failed gets a new try when its URL changes', async ({
    page,
  }) => {
    await page.goto(story('image-url-change'))
    await region(page).waitFor()
    await expect(
      region(page).getByRole('img', { name: './photo.jpg' }),
    ).toBeVisible()
    await page.getByRole('button', { name: 'Fix the image' }).click()
    const image = region(page).locator('img')
    await expect(image).toBeVisible()
    await expect
      .poll(() =>
        image.evaluate((element: HTMLImageElement) => element.naturalWidth),
      )
      .toBe(640)
  })
})

test.describe('the document', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(story('document'))
    await region(page).waitFor()
    await page.waitForFunction(() =>
      [...document.images].every((image) => image.complete),
    )
  })

  test('draws the GFM elements, and keeps the heading levels', async ({
    page,
  }) => {
    const preview = region(page)
    await expect(
      preview.getByRole('heading', { level: 1, name: 'Release notes' }),
    ).toBeVisible()
    await expect(preview.getByRole('table').first()).toBeVisible()
    await expect(preview.locator('del')).toHaveText('strikethrough')
    await expect(
      preview.getByRole('img', { name: 'Done', exact: true }),
    ).toHaveCount(2)
    await expect(
      preview.getByRole('img', { name: 'Not done', exact: true }),
    ).toHaveCount(1)
    // A task list has no input: the preview is read-only.
    await expect(preview.locator('input')).toHaveCount(0)
    await expect(
      preview.getByRole('link', { name: 'https://example.com/changelog' }),
    ).toBeVisible()
    await expect(preview.getByRole('img', { name: 'A photo' })).toBeVisible()
  })

  test('the text can be selected', async ({ page }) => {
    await region(page).getByText('A short paragraph').first().click({
      clickCount: 3,
    })
    expect(await page.evaluate(() => getSelection()?.toString())).toContain(
      'A short paragraph',
    )
  })

  test('the keyboard scrolls the region', async ({ page }) => {
    await region(page).focus()
    await page.keyboard.press('PageDown')
    await expect
      .poll(() => region(page).evaluate((element) => element.scrollTop))
      .toBeGreaterThan(0)
  })

  test('a footnote moves inside the preview, with the focus, and the URL stays', async ({
    page,
  }) => {
    const url = page.url()
    const reference = region(page).locator('a[data-footnote-ref]').first()
    await reference.scrollIntoViewIfNeeded()
    await region(page).evaluate((element) => (element.scrollTop = 0))
    await reference.click()
    expect(page.url()).toBe(url)
    const note = region(page).locator('li[id$="fn-1"]')
    await expect(note).toBeFocused()
    await expect(note).toBeInViewport()
    expect(
      await region(page).evaluate((element) => element.scrollTop),
    ).toBeGreaterThan(0)

    const back = note.locator('a[data-footnote-backref]')
    await back.click()
    expect(page.url()).toBe(url)
    await expect(
      reference.locator('xpath=ancestor-or-self::*[@id][1]'),
    ).toBeFocused()
  })

  test('a table scrolls inside itself at 320 CSS pixels', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 })
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    )
    expect(overflow).toBeLessThanOrEqual(0)
  })
})

test.describe('the remote images control', () => {
  test('allows the images, and the focus stays in the preview', async ({
    page,
  }) => {
    await page.goto(story('remote-blocked'))
    await region(page).waitFor()
    const button = page.getByRole('button', { name: 'Load remote images (3)' })
    await expect(button).toBeVisible()
    await expect(
      region(page).getByRole('img', { name: /images\.example\.com/ }),
    ).toHaveCount(3)
    await button.focus()
    await page.keyboard.press('Enter')
    expect(
      await page.evaluate(
        () => (globalThis as unknown as { allowCalls?: number }).allowCalls,
      ),
    ).toBe(1)
    await expect(region(page)).toBeFocused()
  })

  test('has no control without the handler, or when the images are allowed', async ({
    page,
  }) => {
    await page.goto(story('remote-allowed'))
    await region(page).waitFor()
    await expect(page.getByRole('button')).toHaveCount(0)
    await update(page, 'remote-allowed', {
      remoteImages: false,
      onAllowRemoteImages: undefined,
    })
    await expect(page.getByRole('button')).toHaveCount(0)
  })
})
