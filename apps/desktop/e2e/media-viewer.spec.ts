import { expect, test, type Page } from '@playwright/test'

const story = (name: string) =>
  `/iframe.html?id=screens-mediaviewer--${name}&viewMode=story&globals=a11y.manual:!true`

/** Gives the story new args, as the host of the viewer would. */
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
    { storyId: `screens-mediaviewer--${name}`, args },
  )
}

test.describe('image', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(story('photo'))
    await page.getByRole('img', { name: 'photo.jpg' }).waitFor()
    await expect(page.getByText('640 × 400')).toBeVisible()
  })

  const image = (page: Page) => page.getByRole('img', { name: 'photo.jpg' })
  const width = async (page: Page) =>
    Math.round((await image(page).boundingBox())!.width)

  test('fits the view, and shows the pixel size and the scale', async ({
    page,
  }) => {
    const box = (await image(page).boundingBox())!
    expect(box.width).toBeLessThanOrEqual(1440)
    expect(box.height).toBeLessThanOrEqual(900)
    await expect(page.getByText(/^\d+%$/)).toBeVisible()
  })

  test('the toggle shows the actual size and goes back', async ({ page }) => {
    const toggle = page.getByRole('button', { name: 'Actual size' })
    await expect(toggle).toHaveAttribute('aria-pressed', 'false')
    await toggle.click()
    expect(await width(page)).toBe(640)
    await expect(toggle).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByText('100%')).toBeVisible()
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-pressed', 'false')
  })

  test('the buttons zoom in, zoom out, and reset', async ({ page }) => {
    await page.getByRole('button', { name: 'Actual size' }).click()
    await page.getByRole('button', { name: 'Zoom in' }).click()
    expect(await width(page)).toBe(960)
    await page.getByRole('button', { name: 'Zoom out' }).click()
    await page.getByRole('button', { name: 'Zoom out' }).click()
    expect(await width(page)).toBe(480)
    await page.getByRole('button', { name: 'Fit to view' }).click()
    await expect(
      page.getByRole('button', { name: 'Actual size' }),
    ).toHaveAttribute('aria-pressed', 'false')
  })

  test('the keys +, -, and 0 work while the viewer has the focus', async ({
    page,
  }) => {
    await page.getByRole('button', { name: 'Actual size' }).click()
    await page.getByRole('group', { name: 'photo.jpg' }).focus()
    await page.keyboard.press('+')
    expect(await width(page)).toBe(960)
    await page.keyboard.press('-')
    await page.keyboard.press('-')
    expect(await width(page)).toBe(480)
    await page.keyboard.press('0')
    await expect(page.getByText('640 × 400')).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'Actual size' }),
    ).toHaveAttribute('aria-pressed', 'false')
    // The keys also work with the focus on a button.
    await page.getByRole('button', { name: 'Zoom in' }).focus()
    await page.keyboard.press('=')
    await expect(
      page.getByRole('button', { name: 'Actual size' }),
    ).toHaveAttribute('aria-pressed', 'false')
  })

  test('a key with Ctrl does not zoom', async ({ page }) => {
    await page.getByRole('group', { name: 'photo.jpg' }).focus()
    const before = await width(page)
    await page.keyboard.press('Control+=')
    expect(await width(page)).toBe(before)
  })

  test('a larger image scrolls with the keyboard', async ({ page }) => {
    await page.setViewportSize({ width: 400, height: 300 })
    await page.getByRole('button', { name: 'Actual size' }).click()
    const area = page.getByRole('group', { name: 'photo.jpg' })
    await area.focus()
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('ArrowRight')
    expect(await area.evaluate((element) => element.scrollTop)).toBeGreaterThan(
      0,
    )
    expect(
      await area.evaluate((element) => element.scrollLeft),
    ).toBeGreaterThan(0)
  })

  test('the toolbar stays one row at 320 CSS pixels', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 480 })
    const tops = await page
      .getByRole('button')
      .evaluateAll((buttons) =>
        buttons.map((button) => Math.round(button.getBoundingClientRect().top)),
      )
    expect(new Set(tops).size).toBe(1)
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(0)
  })
})

test('a transparent image sits on the checkerboard', async ({ page }) => {
  await page.goto(story('transparent'))
  const image = page.getByRole('img', { name: 'transparent.png' })
  await image.waitFor()
  await expect(page.getByText('64 × 64')).toBeVisible()
  expect(Math.round((await image.boundingBox())!.width)).toBe(64)
  expect(
    await image.evaluate(
      (element) => getComputedStyle(element).backgroundImage,
    ),
  ).toContain('conic-gradient')
})

test('a file that does not decode shows the error icon', async ({ page }) => {
  await page.goto(story('failed'))
  const mark = page.getByRole('button', { name: 'File error' })
  await expect(mark).toBeVisible()
  await expect(page.getByRole('alert')).toHaveText(
    'broken.png cannot be decoded.',
  )
  await expect(page.locator('img')).toHaveCount(0)
  await mark.focus()
  await expect(page.locator('[data-slot="tooltip-content"]')).toContainText(
    'cannot be decoded',
  )
})

test.describe('video', () => {
  test.beforeEach(async ({ page, browserName }) => {
    await page.goto(story('video'))
    await page.locator('video').waitFor()
    const canPlay = await page.evaluate(
      () =>
        document
          .createElement('video')
          .canPlayType('video/webm; codecs="vp9"') !== '',
    )
    // The WebKit build of Playwright on Linux has no VP9 decoder. The error
    // state is the right result there, and the logic below needs a decoder.
    test.skip(!canPlay, `${browserName} cannot decode the sample video`)
    await page.waitForFunction(
      () =>
        (document.querySelector('video') as HTMLVideoElement).readyState >= 1,
    )
  })

  test('has controls, no autoplay, and loads the metadata only', async ({
    page,
  }) => {
    const video = page.locator('video')
    await expect(video).toHaveAttribute('controls', '')
    await expect(video).toHaveAttribute('preload', 'metadata')
    expect(
      await video.evaluate((element: HTMLVideoElement) => element.paused),
    ).toBe(true)
    expect(
      await video.evaluate((element: HTMLVideoElement) => element.autoplay),
    ).toBe(false)
  })

  test('active false pauses and drops the source, active true restores the position', async ({
    page,
  }) => {
    const video = page.locator('video')
    await video.evaluate(async (element: HTMLVideoElement) => {
      element.muted = true
      await element.play()
    })
    await expect
      .poll(() =>
        video.evaluate((element: HTMLVideoElement) => element.currentTime),
      )
      .toBeGreaterThan(0.4)

    await update(page, 'video', { active: false })
    const state = await video.evaluate((element: HTMLVideoElement) => ({
      paused: element.paused,
      src: element.getAttribute('src'),
      networkState: element.networkState,
    }))
    expect(state.paused).toBe(true)
    expect(state.src).toBeNull()
    // NETWORK_EMPTY: no source, no decoder.
    expect(state.networkState).toBe(0)

    await update(page, 'video', { active: true })
    await expect(video).toHaveAttribute('src', /clip\.webm$/)
    await expect
      .poll(() =>
        video.evaluate((element: HTMLVideoElement) => element.currentTime),
      )
      .toBeGreaterThan(0.3)
    expect(
      await video.evaluate((element: HTMLVideoElement) => element.paused),
    ).toBe(true)
  })
})

test('a video that cannot decode shows the error icon', async ({ page }) => {
  await page.goto(story('video'))
  await page.locator('video, [aria-label="File error"]').first().waitFor()
  const canPlay = await page.evaluate(
    () =>
      document
        .createElement('video')
        .canPlayType('video/webm; codecs="vp9"') !== '',
  )
  test.skip(canPlay, 'this browser decodes the sample video')
  await expect(page.getByRole('button', { name: 'File error' })).toBeVisible()
})

test('an audio file has controls and starts paused', async ({ page }) => {
  await page.goto(story('audio'))
  const audio = page.locator('audio')
  await audio.waitFor()
  await expect(audio).toHaveAttribute('controls', '')
  await expect(audio).toHaveAttribute('preload', 'metadata')
  expect(
    await audio.evaluate((element: HTMLAudioElement) => element.paused),
  ).toBe(true)
})

test('a new kind with the same source starts a new player', async ({
  page,
}) => {
  await page.goto(story('audio'))
  const audio = page.locator('audio')
  await expect(audio).toHaveAttribute('src', /tone\.wav$/)
  await update(page, 'audio', { kind: 'video' })
  await expect(page.locator('audio')).toHaveCount(0)
  await expect(page.locator('video')).toHaveAttribute('src', /tone\.wav$/)
})

test('a file with the wrong kind recovers when the kind is right', async ({
  page,
}) => {
  await page.goto(story('wrong-kind'))
  await expect(page.getByRole('button', { name: 'File error' })).toBeVisible()
  await update(page, 'wrong-kind', { kind: 'audio' })
  await expect(page.locator('audio')).toHaveAttribute('src', /tone\.wav$/)
  await expect(page.getByRole('button', { name: 'File error' })).toHaveCount(0)
  // And back: the wrong kind fails again, with a clean state each time.
  await update(page, 'wrong-kind', { kind: 'image' })
  await expect(page.getByRole('button', { name: 'File error' })).toBeVisible()
})

test('a late decode error moves the focus to the error icon', async ({
  page,
}) => {
  await page.goto(story('photo'))
  await page.getByRole('img', { name: 'photo.jpg' }).waitFor()
  await page.getByRole('button', { name: 'Zoom in' }).focus()
  await page
    .getByRole('img', { name: 'photo.jpg' })
    .evaluate((image) => image.dispatchEvent(new Event('error')))
  const mark = page.getByRole('button', { name: 'File error' })
  await expect(mark).toBeFocused()
  // A failure while the focus is elsewhere does not take it.
  await page.goto(story('photo'))
  await page.getByRole('img', { name: 'photo.jpg' }).waitFor()
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur())
  await page
    .getByRole('img', { name: 'photo.jpg' })
    .evaluate((image) => image.dispatchEvent(new Event('error')))
  await expect(mark).toBeVisible()
  await expect(mark).not.toBeFocused()
})

test.describe('video, fast changes', () => {
  test('the position survives active changes that come before the metadata', async ({
    page,
    browserName,
  }) => {
    await page.goto(story('video'))
    await page.locator('video').waitFor()
    const canPlay = await page.evaluate(
      () =>
        document
          .createElement('video')
          .canPlayType('video/webm; codecs="vp9"') !== '',
    )
    test.skip(!canPlay, `${browserName} cannot decode the sample video`)
    const video = page.locator('video')
    await page.waitForFunction(
      () =>
        (document.querySelector('video') as HTMLVideoElement).readyState >= 1,
    )
    await video.evaluate(async (element: HTMLVideoElement) => {
      element.muted = true
      await element.play()
    })
    await expect
      .poll(() =>
        video.evaluate((element: HTMLVideoElement) => element.currentTime),
      )
      .toBeGreaterThan(0.5)
    // Off, on, off, on in quick turns: the metadata of an interrupted load
    // never came, and the saved position must stay.
    await update(page, 'video', { active: false })
    await update(page, 'video', { active: true })
    await update(page, 'video', { active: false })
    await update(page, 'video', { active: true })
    await expect
      .poll(() =>
        video.evaluate((element: HTMLVideoElement) => element.currentTime),
      )
      .toBeGreaterThan(0.4)
    expect(
      await video.evaluate((element: HTMLVideoElement) => element.paused),
    ).toBe(true)
  })
})
