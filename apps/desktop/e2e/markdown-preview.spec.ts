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
    // <img> is removed, so only three placeholders remain.
    await page.waitForTimeout(500)
    expect(requests).toEqual([])
    // Each blocked image is a placeholder with its host.
    await expect(
      region(page).getByRole('img', { name: /remote-images\.test/ }),
    ).toHaveCount(3)
  })

  test('the same images load when remoteImages is true (the counter works)', async ({
    page,
  }) => {
    const requests = await countRemoteRequests(page)
    await page.goto(story('hostile'))
    await region(page).waitFor()
    await update(page, 'hostile', { remoteImages: true })
    await expect
      .poll(() => [...new Set(requests)].sort())
      .toEqual(['/inline.png', '/reference.png', '/relative.png'])
    // The raw <img> of the document never loads, also when images are allowed.
    expect(requests).not.toContain('/raw.png')
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
    for (const name of ['javascript link', 'vbscript link', 'data link'])
      await expect(region(page).getByRole('link', { name })).toHaveCount(0)
    await expect(region(page)).toContainText('javascript link')
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
      region(page).getByRole('img', { name: /javascript:/ }),
    ).toBeVisible()
  })

  test('a link never navigates: it calls onOpenLink', async ({ page }) => {
    await page.goto(story('hostile'))
    await region(page).waitFor()
    const url = page.url()
    await region(page).getByRole('link', { name: 'safe link' }).click()
    await region(page)
      .getByRole('link', { name: 'safe link' })
      .click({ button: 'middle' })
    expect(page.url()).toBe(url)
    expect(
      await page.evaluate(
        () => (globalThis as unknown as { openedLinks?: string[] }).openedLinks,
      ),
    ).toEqual(['https://example.com/safe'])
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
    await expect(preview.getByRole('table')).toBeVisible()
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
